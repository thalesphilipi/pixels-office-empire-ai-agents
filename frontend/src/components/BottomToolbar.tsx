import { useState } from 'react'
import { SettingsModal } from './SettingsModal.js'
import { useTranslation } from 'react-i18next'

interface BottomToolbarProps {
  isEditMode: boolean
  onOpenClaude: () => void
  onToggleEditMode: () => void
  isDebugMode: boolean
  onToggleDebugMode: () => void
  workspaceFolders: { name: string; path: string }[]
  onOpenAgents: () => void
  onOpenTasks: () => void
  onOpenVault: () => void
  onOpenDivisions: () => void
  onOpenApprovals: () => void
  isChatOpen: boolean
  onToggleChat: () => void
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 10,
  left: 10,
  zIndex: 'var(--pixel-controls-z)',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  background: 'var(--pixel-bg)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  padding: '4px 6px',
  boxShadow: 'var(--pixel-shadow)',
}

const btnBase: React.CSSProperties = {
  padding: '5px 10px',
  fontSize: '24px',
  color: 'var(--pixel-text)',
  background: 'var(--pixel-btn-bg)',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
}

const btnActive: React.CSSProperties = {
  ...btnBase,
  background: 'var(--pixel-active-bg)',
  border: '2px solid var(--pixel-accent)',
}


export function BottomToolbar({
  isEditMode,
  onToggleEditMode,
  isDebugMode,
  onToggleDebugMode,
  onOpenAgents,
  onOpenTasks,
  onOpenVault,
  onOpenDivisions,
  onOpenApprovals,
  isChatOpen,
  onToggleChat,
}: BottomToolbarProps) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState<string | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)


  return (
    <div style={panelStyle}>
      <button
        onClick={onOpenApprovals}
        onMouseEnter={() => setHovered('approvals')}
        onMouseLeave={() => setHovered(null)}
        style={{
          ...btnBase,
          padding: '5px 12px',
          background: hovered === 'approvals' ? '#b00' : '#800',
          border: '2px solid #f00',
          color: '#fff',
        }}
        title="Painel de Aprovações Web3 / Gastos Críticos"
      >
        🚨 Aprovações
      </button>

      <button
        onClick={onOpenAgents}
        onMouseEnter={() => setHovered('staff')}
        onMouseLeave={() => setHovered(null)}
        style={{
          ...btnBase,
          background: hovered === 'staff' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
        }}
        title={t('Manage Staff')}
      >
        {t('Staff')}
      </button>
      <button
        onClick={onOpenTasks}
        onMouseEnter={() => setHovered('tasks')}
        onMouseLeave={() => setHovered(null)}
        style={{
          ...btnBase,
          background: hovered === 'tasks' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
        }}
        title={t('Task List')}
      >
        {t('Tasks')}
      </button>
      <button
        onClick={onOpenDivisions}
        onMouseEnter={() => setHovered('divisions')}
        onMouseLeave={() => setHovered(null)}
        style={{
          ...btnBase,
          background: hovered === 'divisions' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
        }}
        title={t('Divisions / Objectives')}
      >
        {t('Divisions')}
      </button>
      <button
        onClick={onToggleChat}
        onMouseEnter={() => setHovered('chat')}
        onMouseLeave={() => setHovered(null)}
        style={
          isChatOpen
            ? { ...btnActive }
            : {
              ...btnBase,
              background: hovered === 'chat' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
            }
        }
        title={t('Toggle Chat')}
      >
        {t('Chat')}
      </button>
      <button
        onClick={onOpenVault}
        onMouseEnter={() => setHovered('vault')}
        onMouseLeave={() => setHovered(null)}
        style={{
          ...btnBase,
          background: hovered === 'vault' ? '#fbbf24' : btnBase.background,
          color: hovered === 'vault' ? '#000' : btnBase.color,
        }}
        title="Cofre de Chaves (Vault)"
      >
        🔒 Cofre / Hosting
      </button>
      <button
        onClick={onToggleEditMode}
        onMouseEnter={() => setHovered('edit')}
        onMouseLeave={() => setHovered(null)}
        style={
          isEditMode
            ? { ...btnActive }
            : {
              ...btnBase,
              background: hovered === 'edit' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
            }
        }
        title={t('Edit office layout')}
      >
        {t('Layout')}
      </button>
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setIsSettingsOpen((v) => !v)}
          onMouseEnter={() => setHovered('settings')}
          onMouseLeave={() => setHovered(null)}
          style={
            isSettingsOpen
              ? { ...btnActive }
              : {
                ...btnBase,
                background: hovered === 'settings' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
              }
          }
          title={t('Settings')}
        >
          {t('Settings')}
        </button>
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          isDebugMode={isDebugMode}
          onToggleDebugMode={onToggleDebugMode}
        />
      </div>
    </div >
  )
}
