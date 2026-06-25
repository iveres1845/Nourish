'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function SignupPage() {
  const router = useRouter()
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirmPassword) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) { setError(error.message); setLoading(false) }
    else router.push('/onboarding')
  }

  return (
    <div className="min-h-screen bg-cream-50 flex flex-col items-center justify-center px-5">

      {/* Logo */}
      <div className="text-center mb-10 fade-up">
        <div className="w-16 h-16 bg-sage-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-sage-300/40">
          <span className="text-white text-2xl">🌿</span>
        </div>
        <h1 className="text-3xl font-bold text-sage-800 tracking-tight">nourish</h1>
        <p className="text-sm text-gray-400 mt-1.5">fuel your body. understand your body.</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm card p-6 fade-up" style={{ animationDelay: '0.05s' }}>
        <h2 className="text-lg font-bold text-gray-900 mb-5">Create your account</h2>

        <form onSubmit={handleSignup} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
              className="w-full px-3.5 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400 focus:border-transparent bg-cream-50 transition-shadow"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Password</label>
            <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
              className="w-full px-3.5 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400 focus:border-transparent bg-cream-50 transition-shadow"
              placeholder="Min. 8 characters"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Confirm password</label>
            <input type="password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              className="w-full px-3.5 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sage-400 focus:border-transparent bg-cream-50 transition-shadow"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-3">{error}</p>}

          <button type="submit" disabled={loading}
            className="w-full bg-sage-600 hover:bg-sage-700 active:bg-sage-800 disabled:opacity-50 text-white font-semibold py-3.5 rounded-xl text-sm transition-all shadow-lg shadow-sage-300/40 active:scale-[0.98] mt-1">
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-400 mt-5">
          Already have an account?{' '}
          <Link href="/login" className="text-sage-600 font-semibold hover:text-sage-700">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
