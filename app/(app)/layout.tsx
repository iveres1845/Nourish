import BottomNav from '@/components/BottomNav'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-100">
      <div style={{ maxWidth: '430px', margin: '0 auto' }} className="min-h-screen bg-cream-50 relative shadow-xl">
        {children}
        <BottomNav />
        <div className="h-24" />
      </div>
    </div>
  )
}
