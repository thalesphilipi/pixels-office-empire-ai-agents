import { useEffect, useState } from 'react'

interface Approval {
  id: string
  task_id: string
  agent_id: string
  agent_name: string
  action_type: string
  action_data: string
  status: string
  created_at: string
}

interface ApprovalsPanelProps {
  onClose: () => void
}

export function ApprovalsPanel({ onClose }: ApprovalsPanelProps) {
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [loading, setLoading] = useState(false)

  const fetchApprovals = async () => {
    try {
      const res = await fetch('http://localhost:3000/api/approvals')
      if (res.ok) {
        const data = await res.json()
        setApprovals(data)
      }
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    fetchApprovals()
    const interval = setInterval(fetchApprovals, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleAction = async (id: string, action: 'approve' | 'reject') => {
    setLoading(true)
    try {
      await fetch(`http://localhost:3000/api/approvals/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      await fetchApprovals()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'absolute', top: 40, left: 40, width: 600, maxHeight: '80vh',
      background: 'var(--pixel-bg)', border: '2px solid var(--pixel-border)', zIndex: 1000,
      display: 'flex', flexDirection: 'column', color: 'var(--pixel-text)', boxShadow: '0 0 20px rgba(255,0,0,0.3)'
    }}>
      <div style={{ padding: '10px 15px', borderBottom: '2px solid var(--pixel-border)', display: 'flex', justifyContent: 'space-between', background: '#400' }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>🚨 Aprovações Críticas Pendentes</h2>
        <button onClick={onClose} style={{ background: 'transparent', color: 'var(--pixel-text)', border: 'none', cursor: 'pointer', fontSize: 18 }}>×</button>
      </div>

      <div style={{ padding: 15, overflowY: 'auto', flex: 1 }}>
        {approvals.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', opacity: 0.7 }}>Nenhuma transação pendente de aprovação.</div>
        ) : (
          approvals.map(app => {
            let dataView = app.action_data
            try {
              dataView = JSON.stringify(JSON.parse(app.action_data), null, 2)
            } catch (e) {}

            return (
              <div key={app.id} style={{ border: '1px solid var(--pixel-border)', padding: 15, marginBottom: 15, background: 'rgba(255,0,0,0.1)' }}>
                <div style={{ fontWeight: 'bold', marginBottom: 10 }}>ID: {app.id} | Agente: {app.agent_name}</div>
                <div style={{ fontSize: 14, opacity: 0.9, marginBottom: 10 }}>Ação: {app.action_type}</div>
                <pre style={{ background: '#000', padding: 10, fontSize: 12, overflowX: 'auto', border: '1px solid #333' }}>
                  {dataView}
                </pre>
                <div style={{ display: 'flex', gap: 10, marginTop: 15 }}>
                  <button
                    disabled={loading}
                    onClick={() => handleAction(app.id, 'approve')}
                    style={{ flex: 1, padding: 10, background: '#0a0', color: '#fff', border: '2px solid #0f0', cursor: 'pointer', fontWeight: 'bold' }}
                  >
                    ASSINAR E APROVAR
                  </button>
                  <button
                    disabled={loading}
                    onClick={() => handleAction(app.id, 'reject')}
                    style={{ flex: 1, padding: 10, background: '#a00', color: '#fff', border: '2px solid #f00', cursor: 'pointer', fontWeight: 'bold' }}
                  >
                    REJEITAR E ABORTAR
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
