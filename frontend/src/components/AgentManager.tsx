import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const panelStyle: React.CSSProperties = {
    position: 'absolute',
    inset: '40px',
    background: 'var(--pixel-bg)',
    border: '4px solid var(--pixel-border)',
    boxShadow: '8px 8px 0px rgba(0,0,0,0.5)',
    padding: '20px',
    zIndex: 100,
    overflowY: 'auto'
};

const titleStyle: React.CSSProperties = {
    fontSize: '32px',
    color: 'var(--pixel-text)',
    marginBottom: '20px',
    borderBottom: '2px solid var(--pixel-border)',
    paddingBottom: '10px'
};

const btnStyle: React.CSSProperties = {
    padding: '8px 16px',
    fontSize: '20px',
    color: 'var(--pixel-text)',
    background: 'var(--pixel-btn-bg)',
    border: '2px solid transparent',
    cursor: 'pointer',
    marginBottom: '20px'
};

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px',
    fontSize: '18px',
    background: 'var(--pixel-bg)',
    border: '2px solid var(--pixel-border)',
    color: 'var(--pixel-text)',
    marginBottom: '15px'
};

export function AgentManager({ onClose }: { onClose: () => void }) {
    const { t } = useTranslation();
    const [agents, setAgents] = useState<any[]>([]);
    const [editingAgent, setEditingAgent] = useState<any | null>(null);
    const [availableRoles, setAvailableRoles] = useState<string[]>([]);
    const [hostingDomain, setHostingDomain] = useState('');
    const [hostingIp, setHostingIp] = useState('');
    const [hostingUser, setHostingUser] = useState('');
    const [hostingPass, setHostingPass] = useState('');

    const fetchAgents = () => {
        fetch('http://localhost:3000/api/agents')
            .then(res => res.json())
            .then(data => setAgents(data))
            .catch(console.error);
    };

    useEffect(() => {
        fetchAgents();
        fetch('http://localhost:3000/api/roles')
            .then(res => res.json())
            .then(data => setAvailableRoles(data))
            .catch(console.error);
    }, []);

    const saveHosting = async () => {
        const entries = [
            { key_id: 'hosting_domain', key_name: 'Hosting Domain', key_value: hostingDomain, service: 'hosting' },
            { key_id: 'hosting_ftp_host', key_name: 'FTP Host/IP', key_value: hostingIp, service: 'hosting' },
            { key_id: 'hosting_ftp_username', key_name: 'FTP Username', key_value: hostingUser, service: 'hosting' },
            ...(hostingPass ? [{ key_id: 'hosting_ftp_password', key_name: 'FTP Password', key_value: hostingPass, service: 'hosting' }] : [])
        ];
        for (const e of entries) {
            if (!e.key_value) continue;
            await fetch('http://localhost:3000/api/vault', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(e)
            });
        }
        setHostingPass('');
        alert('Hosting salvo no Cofre. Os agentes já podem usar mcp_hosting_deploy_ftp.');
    };

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

    const handleHire = async () => {
        await fetch('http://localhost:3000/api/agents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'New Agent', role: 'Developer' })
        });
        fetchAgents();
    };

    const handleFire = async (id: string) => {
        if (!confirm('Are you sure you want to fire this agent?')) return;

        await fetch(`http://localhost:3000/api/agents/${id}`, {
            method: 'DELETE'
        });
        fetchAgents();
    };

    return (
        <div style={panelStyle}>
            <button style={{ float: 'right', ...btnStyle }} onClick={onClose}>{t('Close')}</button>
            <h2 style={titleStyle}>{t('Manage Staff (Agents)')}</h2>

            <div style={{ border: '2px solid var(--pixel-border)', padding: '12px', marginBottom: '20px', color: 'var(--pixel-text)' }}>
                <div style={{ fontSize: '22px', marginBottom: '10px' }}>Hosting (FTP / Subdomínios)</div>
                <label>Domínio</label>
                <input style={inputStyle} value={hostingDomain} onChange={e => setHostingDomain(e.target.value)} placeholder="instantcalc.info" />
                <label>IP / Host do FTP</label>
                <input style={inputStyle} value={hostingIp} onChange={e => setHostingIp(e.target.value)} placeholder="128.201.75.194" />
                <label>Usuário FTP</label>
                <input style={inputStyle} value={hostingUser} onChange={e => setHostingUser(e.target.value)} placeholder="instantcalc" />
                <label>Senha FTP (não fica visível depois de salvar)</label>
                <input type="password" style={inputStyle} value={hostingPass} onChange={e => setHostingPass(e.target.value)} placeholder="••••••••" />
                <button style={{ ...btnStyle, background: 'var(--pixel-accent)', marginBottom: 0 }} onClick={saveHosting}>
                    Salvar Hosting no Cofre
                </button>
            </div>

            {editingAgent ? (
                <form onSubmit={handleSave} style={{ color: 'var(--pixel-text)' }}>
                    <label>{t('Name')}</label>
                    <input style={inputStyle} value={editingAgent.name} onChange={e => setEditingAgent({ ...editingAgent, name: e.target.value })} />

                    <label>{t('Role')}</label>
                    <select
                        style={inputStyle}
                        value={editingAgent.role}
                        onChange={e => setEditingAgent({ ...editingAgent, role: e.target.value })}
                    >
                        {availableRoles.map(role => (
                            <option key={role} value={role}>{t(role) || role}</option>
                        ))}
                    </select>

                    <label>{t('System Prompt')}</label>
                    <textarea style={{ ...inputStyle, height: '100px', resize: 'vertical' }} value={editingAgent.system_prompt || ''} onChange={e => setEditingAgent({ ...editingAgent, system_prompt: e.target.value })} />

                    <label>{t('LLM Model')} (e.g., qwen3.5-9b-claude-4.6-opus-distilled-32k)</label>
                    <input style={inputStyle} value={editingAgent.llm_model || ''} onChange={e => setEditingAgent({ ...editingAgent, llm_model: e.target.value })} />

                    <label>{t('OpenRouter API Key')}</label>
                    <input type="password" style={inputStyle} value={editingAgent.llm_api_key || ''} onChange={e => setEditingAgent({ ...editingAgent, llm_api_key: e.target.value })} />

                    <label>{t('API Base URL')} (ex: http://localhost:11434/v1)</label>
                    <input style={inputStyle} value={editingAgent.llm_base_url || ''} onChange={e => setEditingAgent({ ...editingAgent, llm_base_url: e.target.value })} />

                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button type="submit" style={btnStyle}>{t('Save')}</button>
                        <button type="button" style={{ ...btnStyle, background: 'var(--pixel-danger-bg)' }} onClick={() => setEditingAgent(null)}>{t('Cancel')}</button>
                    </div>
                </form>
            ) : (
                <>
                    <button style={{ ...btnStyle, background: 'var(--pixel-accent)', marginBottom: '20px' }} onClick={handleHire}>
                        + {t('Hire Agent')}
                    </button>
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
                                <tr key={a.id} style={{ borderBottom: '1px solid var(--pixel-border)' }}>
                                    <td style={{ padding: '8px' }}>{a.id.slice(-6)}</td>
                                    <td>{a.name}</td>
                                    <td>{a.role}</td>
                                    <td>{a.llm_model || 'None'}</td>
                                    <td>
                                        <button style={{ ...btnStyle, fontSize: '16px', padding: '4px 8px', marginBottom: 0, marginRight: '8px' }} onClick={() => setEditingAgent(a)}>{t('Edit')}</button>
                                        <button style={{ ...btnStyle, fontSize: '16px', padding: '4px 8px', marginBottom: 0, background: 'var(--pixel-danger-bg)' }} onClick={() => handleFire(a.id)}>{t('Fire')}</button>
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
