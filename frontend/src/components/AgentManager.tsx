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

    const setPreset = (type: 'lmstudio' | 'openrouter') => {
        if (!editingAgent) return;
        if (type === 'lmstudio') {
            setEditingAgent({
                ...editingAgent,
                llm_model: 'qwen3.5-4b-uncensored-hauhaucs-aggressive',
                llm_base_url: 'http://host.docker.internal:1234/v1',
                llm_api_key: 'lm-studio'
            });
        } else if (type === 'openrouter') {
            setEditingAgent({
                ...editingAgent,
                llm_model: 'anthropic/claude-3.5-sonnet',
                llm_base_url: 'https://openrouter.ai/api/v1',
                llm_api_key: '' // Deve ser preenchido pelo usuário
            });
        }
    };

    const handleHardReset = async () => {
        if (!confirm('⚠️ ATENÇÃO: Isso vai DEMITIR toda a equipe atual, apagar todo o histórico de mensagens, tarefas e conhecimento da agência, e contratar um novo "Dream Team" novinho em folha. Tem certeza absoluta?')) return;

        await fetch('http://localhost:3000/api/admin/reset', { method: 'POST' });
        window.location.reload(); // Reload the whole UI to fetch new state
    };

    return (
        <div style={panelStyle}>
            <button style={{ float: 'right', ...btnStyle }} onClick={onClose}>{t('Close')}</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '25px', borderBottom: '4px solid var(--pixel-border)', paddingBottom: '15px' }}>
                <h2 style={{ ...titleStyle, borderBottom: 'none', paddingBottom: 0, margin: 0 }}>Gerenciar Equipe (Agentes)</h2>
                {!editingAgent && (
                    <button
                        onClick={handleHardReset}
                        style={{ ...btnStyle, fontSize: '14px', background: '#a00', borderColor: '#f00', padding: '6px 12px', marginBottom: 0, marginLeft: 'auto' }}
                        title="Se você estiver com agentes antigos, use isso para recriar a agência do zero."
                    >
                        🔄 Resetar para Padrão de Fábrica (Dream Team)
                    </button>
                )}
            </div>

            {editingAgent ? (
                <form onSubmit={handleSave} style={{ color: 'var(--pixel-text)' }}>
                    <div style={{ marginBottom: '20px', padding: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--pixel-border)' }}>
                        <h3 style={{ margin: 0, color: 'var(--pixel-accent)' }}>Editando {editingAgent.name} ({editingAgent.role})</h3>
                        <p style={{ fontSize: '12px', opacity: 0.7, margin: '5px 0 0 0' }}>Agência Turn-key: O Nome e a Role são fixos. Você pode otimizar o cérebro híbrido abaixo.</p>
                    </div>

                    <label style={{fontSize: '18px', fontWeight: 'bold'}}>{t('System Prompt')} (Otimizado da Agência)</label>
                    <textarea style={{ ...inputStyle, height: '200px', resize: 'vertical', lineHeight: '1.5' }} value={editingAgent.system_prompt || ''} onChange={e => setEditingAgent({ ...editingAgent, system_prompt: e.target.value })} />

                    <h3 style={{ marginTop: '20px', borderBottom: '1px solid var(--pixel-border)', paddingBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>🧠 Configuração de Cérebro Híbrido</span>
                    </h3>

                    <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                        <button type="button" onClick={() => setPreset('lmstudio')} style={{ ...btnStyle, fontSize: '14px', padding: '8px 12px', background: '#3b82f6', borderColor: '#2563eb', marginBottom: 0 }}>
                            🤖 Usar LM Studio Local (host.docker.internal)
                        </button>
                        <button type="button" onClick={() => setPreset('openrouter')} style={{ ...btnStyle, fontSize: '14px', padding: '8px 12px', background: '#8b5cf6', borderColor: '#7c3aed', marginBottom: 0 }}>
                            ☁️ Usar Nuvem (OpenRouter / Claude)
                        </button>
                    </div>

                    <label>{t('LLM Model')} (Ex: qwen3.5-4b-uncensored-hauhaucs-aggressive ou anthropic/claude-3.5-sonnet)</label>
                    <input style={inputStyle} value={editingAgent.llm_model || ''} onChange={e => setEditingAgent({ ...editingAgent, llm_model: e.target.value })} placeholder="Ex: qwen3.5-4b-uncensored-hauhaucs-aggressive" />

                    <label>{t('API Base URL')} (Ex: http://host.docker.internal:1234/v1 para local ou https://openrouter.ai/api/v1 para Nuvem)</label>
                    <input style={inputStyle} value={editingAgent.llm_base_url || ''} onChange={e => setEditingAgent({ ...editingAgent, llm_base_url: e.target.value })} placeholder="Ex: http://host.docker.internal:1234/v1" />

                    <label>{t('API Key')} (Qualquer valor para Local, ou sua sk-or-... para OpenRouter)</label>
                    <input type="password" style={inputStyle} value={editingAgent.llm_api_key || ''} onChange={e => setEditingAgent({ ...editingAgent, llm_api_key: e.target.value })} placeholder="Deixe em branco ou use lm-studio para local" />

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
