/**
 * Dependency-free feasibility/range solver for the menu planner.
 *
 * The problem: given a list of foods (variables, one gram-quantity each,
 * bounded to a sane per-food range) and a handful of aggregate linear
 * constraints (calorie range, protein range, carb range, fat range), find:
 *   1. Whether ANY combination of quantities satisfies all constraints.
 *   2. One such combination (a "suggested" starting point).
 *   3. For each food, the full range of quantities [min, max] for which
 *      *some* combination of the other foods makes the whole day feasible.
 *
 * This is a small linear program. We don't have network access to install
 * a real LP/simplex package (the sandbox this was built in can't reach the
 * npm registry), so this implements POCS -- "projection onto convex sets" --
 * a standard, easy-to-verify iterative method: box bounds and each linear
 * range constraint are each convex sets, and cyclically projecting a point
 * onto each of them in turn is mathematically guaranteed to converge to a
 * point in their intersection whenever one exists. It's slower than a real
 * simplex solver but for ~5-15 foods and 4 constraints it converges in low
 * single-digit milliseconds, which is all this feature needs.
 */

export type RangeConstraint = {
    /** One coefficient per variable, e.g. protein-per-gram for each food. */
    coeffs: number[]
    lo: number
    hi: number
    /** Absolute tolerance for "satisfied". Defaults to 1% of (hi - lo). */
    tol?: number
    /** Human label for diagnostics, e.g. 'protein'. */
    label?: string
}

export type Bounds = [number, number]

export type SolveResult = {
    point: number[]
    feasible: boolean
}

export type FoodRange = {
    min: number
    max: number
    suggested: number
}

const DEFAULT_MAX_ITER = 800
const DEFAULT_TOL = 1e-5

function projectOntoBox(x: number[], bounds: Bounds[]): number[] {
    return x.map((v, i) => Math.min(bounds[i][1], Math.max(bounds[i][0], v)))
}

function projectOntoRange(x: number[], c: RangeConstraint): number[] {
    let val = 0
    for (let i = 0; i < x.length; i++) val += c.coeffs[i] * x[i]

  let target: number | null = null
    if (val < c.lo) target = c.lo
    else if (val > c.hi) target = c.hi
    else return x.slice()

  let normSq = 0
    for (const coeff of c.coeffs) normSq += coeff * coeff
    if (normSq < 1e-12) return x.slice()

  const delta = (target - val) / normSq
    return x.map((v, i) => v + delta * c.coeffs[i])
}

function constraintTolerance(c: RangeConstraint): number {
    return c.tol ?? Math.max(1e-3, (c.hi - c.lo) * 0.01)
}

function constraintSatisfied(x: number[], c: RangeConstraint): boolean {
    let val = 0
    for (let i = 0; i < x.length; i++) val += c.coeffs[i] * x[i]
    const tol = constraintTolerance(c)
    return val >= c.lo - tol && val <= c.hi + tol
}

function allSatisfied(x: number[], constraints: RangeConstraint[], bounds: Bounds[]): boolean {
    for (let i = 0; i < x.length; i++) {
          if (x[i] < bounds[i][0] - 1e-6 || x[i] > bounds[i][1] + 1e-6) return false
    }
    return constraints.every(c => constraintSatisfied(x, c))
}

/**
 * Find a point satisfying all box bounds and range constraints, if one
 * exists. Starts at the midpoint of the box and cyclically projects onto
 * each convex set (box, then each constraint in turn, re-clipping to the
 * box after every projection) until it converges or runs out of iterations.
 */
export function solveFeasible(
    bounds: Bounds[],
    constraints: RangeConstraint[],
    opts: { maxIter?: number; tol?: number } = {}
  ): SolveResult {
    if (bounds.length === 0) {
          // No free variables -- every constraint is already a fixed constant
      // (this happens when reduceForPin() folds the last variable away).
      return { point: [], feasible: constraints.every(c => constraintSatisfied([], c)) }
    }

  const maxIter = opts.maxIter ?? DEFAULT_MAX_ITER
    const tol = opts.tol ?? DEFAULT_TOL

  let x = bounds.map(([lo, hi]) => (lo + hi) / 2)

  for (let iter = 0; iter < maxIter; iter++) {
        const prev = x.slice()
        x = projectOntoBox(x, bounds)
        for (const c of constraints) {
                x = projectOntoRange(x, c)
                x = projectOntoBox(x, bounds)
        }
        let maxDiff = 0
        for (let i = 0; i < x.length; i++) maxDiff = Math.max(maxDiff, Math.abs(x[i] - prev[i]))
        if (maxDiff < tol && allSatisfied(x, constraints, bounds)) break
  }

  return { point: x, feasible: allSatisfied(x, constraints, bounds) }
}

/**
 * Fold variable `pinIndex` to a fixed value `pinValue`, folding its
 * contribution into each constraint's lo/hi and dropping it from the
 * system entirely. This is the exact way to ask "is the REST of the
 * system feasible if this one food is fixed at this quantity" -- as
 * opposed to projecting the full system and then resetting the pinned
 * coordinate afterward, which wastes most of each correction step when
 * the pinned variable has a large coefficient (e.g. a protein-dense food)
 * and can misreport a genuinely feasible point as infeasible.
 */
function reduceForPin(
    bounds: Bounds[],
    constraints: RangeConstraint[],
    pinIndex: number,
    pinValue: number
  ): { bounds: Bounds[]; constraints: RangeConstraint[] } {
    const newBounds = bounds.filter((_, i) => i !== pinIndex)
    const newConstraints = constraints.map(c => ({
          coeffs: c.coeffs.filter((_, i) => i !== pinIndex),
          lo: c.lo - c.coeffs[pinIndex] * pinValue,
          hi: c.hi - c.coeffs[pinIndex] * pinValue,
          tol: c.tol,
          label: c.label,
    }))
    return { bounds: newBounds, constraints: newConstraints }
}

/**
 * Find the full achievable range [min, max] for one food's quantity, given
 * that every other food is free to move within its own bounds to keep the
 * whole day feasible. Returns null if the system has no feasible point at
 * all (caller should already have checked overall feasibility first).
 *
 * The achievable range for a single coordinate of a convex feasible region
 * is itself an interval -- so we find one known-feasible value (from an
 * overall solve) and bisect OUTWARD from it toward each box bound. That
 * seed-outward search is important: bisecting directly between the two box
 * bounds only works if the feasible interval touches one of them, and
 * silently gives wrong answers when the true range sits strictly inside
 * the box (e.g. a food that can't go all the way to its own minimum
 * without another food's macro contribution making the day infeasible).
 */
export function findRange(
    bounds: Bounds[],
    constraints: RangeConstraint[],
    varIndex: number,
    opts: { maxIter?: number; tol?: number; bisectionSteps?: number } = {}
  ): FoodRange | null {
    const [lo, hi] = bounds[varIndex]
    const base = solveFeasible(bounds, constraints, opts)
    if (!base.feasible) return null

  const seed = base.point[varIndex]
    const steps = opts.bisectionSteps ?? 30

  function feasibleAt(t: number): boolean {
        const reduced = reduceForPin(bounds, constraints, varIndex, t)
        return solveFeasible(reduced.bounds, reduced.constraints, opts).feasible
  }

  let maxT = seed
    if (feasibleAt(hi)) {
          maxT = hi
    } else {
          let loB = seed
          let hiB = hi
          for (let i = 0; i < steps; i++) {
                  const mid = (loB + hiB) / 2
                  if (feasibleAt(mid)) loB = mid
                  else hiB = mid
          }
          maxT = loB
    }

  let minT = seed
    if (feasibleAt(lo)) {
          minT = lo
    } else {
          let loB = lo
          let hiB = seed
          for (let i = 0; i < steps; i++) {
                  const mid = (loB + hiB) / 2
                  if (feasibleAt(mid)) hiB = mid
                  else loB = mid
          }
          minT = hiB
    }

  return { min: minT, max: maxT, suggested: seed }
}

/**
 * Cheap, exact pre-check: for one constraint, what's the widest possible
 * achieved value using only the box bounds (ignoring all other
 * constraints)? If even this best-case (or worst-case) envelope can't
 * reach the target range, the system is provably infeasible on that
 * resource alone -- useful for producing a specific, actionable message
 * ("max protein achievable with this list is 42g, target minimum is 90g")
 * before running the full solver.
 */
export function achievableRange(bounds: Bounds[], coeffs: number[]): { min: number; max: number } {
    let min = 0
    let max = 0
    for (let i = 0; i < coeffs.length; i++) {
          const [lo, hi] = bounds[i]
          if (coeffs[i] >= 0) {
                  min += coeffs[i] * lo
                  max += coeffs[i] * hi
          } else {
                  min += coeffs[i] * hi
                  max += coeffs[i] * lo
          }
    }
    return { min, max }
}
