import React, { useEffect, useMemo, useState } from 'react'

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  inset: '40px',
  background: 'var(--pixel-bg)',
  border: '4px solid var(--pixel-border)',
  boxShadow: '8px 8px 0px rgba(0,0,0,0.5)',
  padding: '20px',
  zIndex: 100,
  overflowY: 'auto',
}

const titleStyle: React.CSSProperties = {
  fontSize: '32px',
  color: 'var(--pixel-text)',
  marginBottom: '20px',
  borderBottom: '2px solid var(--pixel-border)',
  paddingBottom: '10px',
}

const btnStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: '20px',
  color: 'var(--pixel-text)',
  background: 'var(--pixel-btn-bg)',
  border: '2px solid transparent',
  cursor: 'pointer',
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '8px',
  fontSize: '18px',
  background: 'var(--pixel-bg)',
  border: '2px solid var(--pixel-border)',
  color: 'var(--pixel-text)',
}

type Division = {
  id: string
  title: string
  objective_prompt: string
  status: string
  created_at: string
  agent_count?: number
  pending_tasks?: number
}

type AgentRow = {
  id: string
  name: string
  role: string
  division_id?: string | null
}

export function DivisionsManager({ onClose }: { onClose: () => void }) {
  const [divisions, setDivisions] = useState<Division[]>([])
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [title, setTitle] = useState('')
  const [objective, setObjective] = useState('')
  const [assignAgentId, setAssignAgentId] = useState<string>('')

  const fetchAll = async () => {
    const [divRes, agentRes] = await Promise.all([
      fetch('http://localhost:3000/api/divisions'),
      fetch('http://localhost:3000/api/agents'),
    ])
    const [divData, agentData] = await Promise.all([divRes.json(), agentRes.json()])
    setDivisions(Array.isArray(divData) ? divData : [])
    setAgents(Array.isArray(agentData) ? agentData : [])
  }

  useEffect(() => {
    fetchAll().catch(console.error)
  }, [])

  const agentsByDivision = useMemo(() => {
    const map = new Map<string, AgentRow[]>()
    for (const a of agents) {
      const key = a.division_id || ''
      if (!key) continue
      const list = map.get(key) || []
      list.push(a)
      map.set(key, list)
    }
    return map
  }, [agents])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const t = title.trim()
    const o = objective.trim()
    if (!t || !o) return
    await fetch('http://localhost:3000/api/divisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: t, objective_prompt: o }),
    })
    setTitle('')
    setObjective('')
    await fetchAll()
  }

  const handleAssign = async (divisionId: string) => {
    if (!assignAgentId) return
    await fetch(`http://localhost:3000/api/divisions/${divisionId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: assignAgentId }),
    })
    setAssignAgentId('')
    await fetchAll()
  }

  const handleUnassign = async (divisionId: string, agentId: string) => {
    await fetch(`http://localhost:3000/api/divisions/${divisionId}/unassign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId }),
    })
    await fetchAll()
  }

  const handleDelete = async (divisionId: string) => {
    await fetch(`http://localhost:3000/api/divisions/${divisionId}`, { method: 'DELETE' })
    await fetchAll()
  }

  return (
    <div style={panelStyle}>
      <button style={{ float: 'right', ...btnStyle }} onClick={onClose}>Close</button>
      <h2 style={titleStyle}>Divisões (Objetivos)</h2>

      <form onSubmit={handleCreate} style={{ display: 'grid', gap: 10, marginBottom: 20 }}>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Nome da divisão (ex: Projeto A / SEO SaaS / Landing X)"
          style={inputStyle}
        />
        <textarea
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder="Prompt/objetivo do projeto (o que entregar, pra quem, restrições, métrica de sucesso)"
          rows={4}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button type="submit" style={btnStyle}>Criar</button>
          <button type="button" style={btnStyle} onClick={() => fetchAll()}>Atualizar</button>
        </div>
      </form>

      {divisions.length === 0 ? (
        <div style={{ color: 'var(--pixel-text)' }}>Nenhuma divisão criada ainda.</div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {divisions.map((d) => {
            const assigned = agentsByDivision.get(d.id) || []
            return (
              <div key={d.id} style={{ border: '2px solid var(--pixel-border)', padding: 12 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ color: 'var(--pixel-text)', fontSize: 22 }}>
                    {d.title} <span style={{ opacity: 0.7, fontSize: 16 }}>({d.status})</span>
                  </div>
                  <button style={btnStyle} onClick={() => handleDelete(d.id)}>Excluir</button>
                </div>
                <div style={{ color: 'var(--pixel-text)', opacity: 0.9, marginTop: 8, whiteSpace: 'pre-wrap' }}>
                  {d.objective_prompt}
                </div>
                <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ color: 'var(--pixel-text)', opacity: 0.8 }}>
                    Agentes: {assigned.length} | Pendências: {d.pending_tasks ?? 0}
                  </div>
                  <select
                    value={assignAgentId}
                    onChange={(e) => setAssignAgentId(e.target.value)}
                    style={{ ...inputStyle, flex: 'unset', minWidth: 220 }}
                  >
                    <option value="">Atribuir agente…</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.role}) {a.division_id ? '— já alocado' : ''}
                      </option>
                    ))}
                  </select>
                  <button style={btnStyle} onClick={() => handleAssign(d.id)}>Atribuir</button>
                </div>

                {assigned.length > 0 && (
                  <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                    {assigned.map((a) => (
                      <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ color: 'var(--pixel-text)' }}>{a.name} <span style={{ opacity: 0.7 }}>({a.role})</span></div>
                        <button style={btnStyle} onClick={() => handleUnassign(d.id, a.id)}>Desalocar</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

