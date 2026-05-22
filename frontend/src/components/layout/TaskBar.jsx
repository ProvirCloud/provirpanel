import { useTask } from '../../app/providers/task-provider'

export default function TaskBar() {
  const { tasks } = useTask()

  if (tasks.length === 0) return null

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      height: 3, background: 'rgba(59,130,246,0.15)', overflow: 'hidden'
    }}>
      <div style={{
        height: '100%', width: '30%',
        background: 'linear-gradient(90deg, transparent, #3b82f6, transparent)',
        animation: 'taskSlide 1.2s ease-in-out infinite',
      }} />
      <style>{`@keyframes taskSlide { 0% { transform: translateX(-100%) } 100% { transform: translateX(400%) } }`}</style>
    </div>
  )
}
