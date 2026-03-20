import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const panelStyle: React.CSSProperties = {
    position: 'absolute',
    inset: '40px',
    background: 'var(--pixel-bg)',
    border: '4px solid var(--pixel-border)',
    boxShadow: '12px 12px 0px rgba(0,0,0,0.5)',
    padding: '30px',
    zIndex: 100,
    overflowY: 'auto',
    fontFamily: '"Courier New", Courier, monospace'
};

const titleStyle: React.CSSProperties = {
    fontSize: '38px',
    color: 'var(--pixel-accent)',
    marginBottom: '25px',
    borderBottom: '4px solid var(--pixel-border)',
    paddingBottom: '15px',
    textTransform: 'uppercase',
    textShadow: '2px 2px 0px #000'
};

const btnStyle: React.CSSProperties = {
    padding: '12px 24px',
    fontSize: '22px',
    fontWeight: 'bold',
    color: 'var(--pixel-text)',
    background: 'var(--pixel-btn-bg)',
    border: '4px solid var(--pixel-border)',
    cursor: 'pointer',
    marginBottom: '20px',
    textTransform: 'uppercase'
};

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px',
    fontSize: '20px',
    background: 'rgba(0,0,0,0.5)',
    border: '2px solid var(--pixel-border)',
    color: '#fff',
    marginBottom: '25px',
    fontFamily: 'monospace'
};

export function AgentManager({ onClose }: { onClose: () => void }) {
    const { t } = useTranslation();
    const [agents, setAgents] = useState<any[]>([]);
    const [editingAgent, setEditingAgent] = useState<any | null>(null);

    const fetchAgents = () => {
        fetch('http://localhost:3000/api/agents')
            .then(res => res.json())
            .then(data => setAgents(data))
            .catch(console.error);
    };

    useEffect(() => {
        fetchAgents();
    }, []);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingAgent) return;

        await fetch(`http://localhost:3000/api/agents/${editingAgent.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(editingAgent)
        });

        setEditingAgent(null);
        fetchAgents();
    };

    return (
        <div style={panelStyle}>
            <button style={{ float: 'right', ...btnStyle }} onClick={onClose}>{t('Close')}</button>
            <h2 style={titleStyle}>{t('Manage Staff (Agents)')}</h2>

            {editingAgent ? (
                <form onSubmit={handleSave} style={{ color: 'var(--pixel-text)' }}>
                    <div style={{ marginBottom: '20px', padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--pixel-border)' }}>
                        <h3 style={{ margin: 0, color: 'var(--pixel-accent)' }}>Editando {editingAgent.name} ({editingAgent.role})</h3>
                        <p style={{ fontSize: '12px', opacity: 0.7, margin: '5px 0 0 0' }}>Agência Turn-key: O Nome e a Role são fixos. Você pode otimizar o cérebro híbrido abaixo.</p>
                    </div>

                    <label style={{fontSize: '18px', fontWeight: 'bold'}}>{t('System Prompt')} (Otimizado da Agência)</label>
                    <textarea style={{ ...inputStyle, height: '200px', resize: 'vertical', lineHeight: '1.5' }} value={editingAgent.system_prompt || ''} onChange={e => setEditingAgent({ ...editingAgent, system_prompt: e.target.value })} />

                    <h3 style={{ marginTop: '20px', borderBottom: '1px solid var(--pixel-border)', paddingBottom: '10px' }}>🧠 Configuração de Cérebro Híbrido</h3>

                    <label>{t('LLM Model')} (Deixe vazio para usar a RTX 4060 Local ou preencha ex: anthropic/claude-3.5-sonnet)</label>
                    <input style={inputStyle} value={editingAgent.llm_model || ''} onChange={e => setEditingAgent({ ...editingAgent, llm_model: e.target.value })} placeholder="anthropic/claude-3.5-sonnet" />

                    <label>{t('OpenRouter API Key')} (Para usar Nuvem)</label>
                    <input type="password" style={inputStyle} value={editingAgent.llm_api_key || ''} onChange={e => setEditingAgent({ ...editingAgent, llm_api_key: e.target.value })} placeholder="sk-or-v1-..." />

                    <label>{t('API Base URL')} (Para Cloud ex: https://openrouter.ai/api/v1)</label>
                    <input style={inputStyle} value={editingAgent.llm_base_url || ''} onChange={e => setEditingAgent({ ...editingAgent, llm_base_url: e.target.value })} placeholder="https://openrouter.ai/api/v1" />

                    <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                        <button type="submit" style={btnStyle}>{t('Save')}</button>
                        <button type="button" style={{ ...btnStyle, background: 'var(--pixel-danger-bg)' }} onClick={() => setEditingAgent(null)}>{t('Cancel')}</button>
                    </div>
                </form>
            ) : (
                <>
                    <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', color: 'var(--pixel-text)' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid var(--pixel-border)' }}>
                                <th>{t('ID')}</th>
                                <th>{t('Name')}</th>
                                <th>{t('Role')}</th>
                                <th>{t('Model')}</th>
                                <th>{t('Actions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {agents.map(a => (
                                <tr key={a.id} style={{ borderBottom: '2px solid var(--pixel-border)', background: 'rgba(255,255,255,0.02)' }}>
                                    <td style={{ padding: '15px', fontSize: '18px' }}>{a.id.slice(-6)}</td>
                                    <td style={{ padding: '15px', fontSize: '20px', fontWeight: 'bold', color: 'var(--pixel-accent)' }}>{a.name}</td>
                                    <td style={{ padding: '15px', fontSize: '18px' }}>{a.role}</td>
                                    <td style={{ padding: '15px', fontSize: '18px', color: '#ff5' }}>{a.llm_model || 'Local / Global'}</td>
                                    <td style={{ padding: '15px' }}>
                                        <button style={{ ...btnStyle, fontSize: '18px', padding: '8px 16px', marginBottom: 0, marginRight: '8px', background: '#080', borderColor: '#0f0' }} onClick={() => setEditingAgent(a)}>{t('Edit')}</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            )}
        </div>
    );
}
