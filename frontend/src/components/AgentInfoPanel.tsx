import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const panelStyle: React.CSSProperties = {
    position: 'absolute',
    right: '20px',
    top: '20px',
    width: '320px',
    background: 'var(--pixel-bg)',
    border: '4px solid var(--pixel-border)',
    boxShadow: '8px 8px 0px rgba(0,0,0,0.5)',
    padding: '20px',
    zIndex: 100,
    overflowY: 'auto',
    maxHeight: 'calc(100vh - 40px)',
    color: 'var(--pixel-text)',
    fontFamily: 'var(--vscode-editor-font-family, "Courier New", monospace)',
};

const titleStyle: React.CSSProperties = {
    fontSize: '24px',
    color: 'var(--pixel-accent)',
    marginBottom: '10px',
    borderBottom: '2px solid var(--pixel-border)',
    paddingBottom: '5px',
    textTransform: 'uppercase'
};

const sectionStyle: React.CSSProperties = {
    padding: '10px 0',
    borderBottom: '1px dashed var(--pixel-border)',
    fontSize: '14px',
};

const btnStyle: React.CSSProperties = {
    padding: '8px',
    marginTop: '15px',
    fontSize: '14px',
    color: 'var(--pixel-text)',
    background: 'var(--pixel-btn-bg)',
    border: '2px solid transparent',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'center'
};

export function AgentInfoPanel({ agentId, onClose }: { agentId: number, onClose: () => void }) {
    const { t } = useTranslation();
    const [agentData, setAgentData] = useState<any>(null);
    const [tasks, setTasks] = useState<any[]>([]);

    useEffect(() => {
        // Fetch specific agent data
        fetch('http://localhost:3000/api/agents')
            .then(res => res.json())
            .then(data => {
                const found = data.find((a: any) => Number(a.id.slice(-6)) === agentId || Number(a.id) === agentId);
                if (found) setAgentData(found);
            })
            .catch(console.error);

        // Fetch recent accomplishments (tasks)
        fetch('http://localhost:3000/api/tasks')
            .then(res => res.json())
            .then(data => {
                const agentTasks = data.filter((t: any) => {
                    const foundAgentId = Number(t.agent_id.slice(-6)) || Number(t.agent_id);
                    return foundAgentId === agentId;
                }).slice(0, 5); // top 5
                setTasks(agentTasks);
            })
            .catch(console.error);
    }, [agentId]);

    if (!agentData) return null;

    return (
        <div style={panelStyle} className="pixel-agents-fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={titleStyle}>{agentData.name}</h2>
                <button
                    onClick={onClose}
                    style={{ background: 'transparent', border: 'none', color: 'var(--pixel-text)', fontSize: '20px', cursor: 'pointer', outline: 'none' }}
                >
                    ×
                </button>
            </div>

            <div style={sectionStyle}>
                <strong>{t('Role')}:</strong> {agentData.role}
            </div>

            <div style={sectionStyle}>
                <strong>{t('Model')}:</strong> {agentData.llm_model || 'N/A'}
            </div>

            <div style={sectionStyle}>
                <strong>{t('Mission Profile')}:</strong>
                <p style={{ fontStyle: 'italic', opacity: 0.8, fontSize: '12px', marginTop: '5px' }}>
                    {agentData.system_prompt ? agentData.system_prompt.slice(0, 100) + '...' : 'Base directive.'}
                </p>
            </div>

            <div style={sectionStyle}>
                <strong style={{ color: 'var(--pixel-success-text)' }}>{t('Real-World Log')}:</strong>
                <ul style={{ paddingLeft: '20px', margin: '10px 0 0 0', opacity: 0.9 }}>
                    {tasks.length > 0 ? tasks.map(t => (
                        <li key={t.id} style={{ marginBottom: '5px' }}>
                            {t.description}
                            {t.status === 'completed' && ' ✅'}
                        </li>
                    )) : (
                        <li>{t('No completed actions yet.')}</li>
                    )}
                </ul>
            </div>

            <button style={btnStyle} onClick={() => alert('Agent performance review module upcoming!')}>
                {t('View Full Report')}
            </button>
        </div>
    );
}
