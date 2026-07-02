/**
 * Open Food Facts API client — free, open, community-maintained database of
 * branded/packaged food products (2.5M+ products, 180+ countries, no API key).
 *
 * Used ONLY as a second branded-food source, tried after USDA's own Branded
 * Foods search (searchBrandedFood in nutrition.ts) fails to find a usable
 * match. Generic, unbranded foods never reach this at all — that gate lives
 * entirely in lookupFoodNutrients()'s `looksLikeBrandedFood(name)` check, and
 * this module has no generic/whole-food search of its own.
 *
 * Docs: https://openfoodfacts.github.io/openfoodfacts-server/api/
 * Uses the newer search-a-licious full-text backend at search.openfoodfacts.org
 * — the legacy world.openfoodfacts.org/cgi/search.pl endpoint frequently
 * rate-limits anonymous requests and returned an interstitial page in testing.
 */

const OFF_SEARCH_BASE = 'https://search.openfoodfacts.org/search'

interface OFFHit {
  code: string
  product_name?: string
  brands?: string[]
  nutriments?: Record<string, number>
}

interface OFFSearchResponse {
  hits: OFFHit[]
}

/**
 * Search Open Food Facts by free-text product name (e.g. "Fairlife whole
 * milk", "Mission Carb Balance tortilla"). Returns up to 8 candidates with
 * per-100g nutrients already mapped to our internal key names — OFF's search
 * response includes full nutriment data inline on each hit, so no second
 * per-product fetch is needed (unlike USDA's search-then-fetch-by-id flow).
 */
export async function searchOpenFoodFacts(query: string): Promise<Array<{
  code: string
  description: string
  per100g: Record<string, number>
}>> {
  try {
    const url = new URL(OFF_SEARCH_BASE)
    url.searchParams.set('q', query)
    url.searchParams.set('page_size', '8')

    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Nourish-Nutrition-App/1.0 (contact via app)' },
    })
    if (!res.ok) {
      console.warn(`Open Food Facts search failed for "${query}": ${res.status}`)
      return []
    }

    const data = (await res.json()) as OFFSearchResponse
    return (data.hits ?? [])
      .filter(h => h.product_name && h.nutriments)
      .slice(0, 8)
      .map(h => ({
        code: h.code,
        description: `${h.product_name}${h.brands?.length ? ' (' + h.brands[0] + ')' : ''}`,
        per100g: mapNutriments(h.nutriments!),
      }))
  } catch (err) {
    console.warn(`Open Food Facts fetch error for "${query}":`, err)
    return []
  }
}

/**
 * Map OFF's `{nutrient}_100g` field names to our internal per-100g schema
 * (same shape USDA's getFoodNutrients() returns, so both sources are
 * interchangeable downstream). OFF reports sodium in grams, not mg — convert
 * to match the sodium_mg convention used everywhere else in the app.
 */
function mapNutriments(n: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {}
  if (typeof n['energy-kcal_100g'] === 'number') result.energy_kcal = n['energy-kcal_100g']
  if (typeof n['proteins_100g'] === 'number') result.protein_g = n['proteins_100g']
  if (typeof n['fat_100g'] === 'number') result.fat_g = n['fat_100g']
  if (typeof n['carbohydrates_100g'] === 'number') result.carbohydrate_g = n['carbohydrates_100g']
  if (typeof n['fiber_100g'] === 'number') result.fiber_g = n['fiber_100g']
  if (typeof n['sugars_100g'] === 'number') result.sugar_g = n['sugars_100g']
  if (typeof n['saturated-fat_100g'] === 'number') result.saturated_fat_g = n['saturated-fat_100g']
  if (typeof n['sodium_100g'] === 'number') result.sodium_mg = n['sodium_100g'] * 1000
  return result
}
