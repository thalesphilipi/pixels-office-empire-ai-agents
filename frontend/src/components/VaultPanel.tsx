import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface VaultKey {
    key_id: string;
    key_name: string;
    service: string;
    created_at: string;
}

const panelStyle: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: '20px',
    background: 'rgba(10, 15, 30, 0.4)',
    color: '#e2e8f0',
    fontFamily: '"Press Start 2P", monospace',
    fontSize: '9px',
};

const keyCardStyle: React.CSSProperties = {
    background: 'rgba(30, 41, 59, 0.7)',
    border: '2px solid var(--pixel-border)',
    borderRadius: '4px',
    padding: '15px',
    marginBottom: '15px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
};

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px',
    marginBottom: '15px',
    background: 'rgba(15, 23, 42, 0.8)',
    border: '1px solid var(--pixel-border)',
    color: '#fff',
    fontFamily: '"Press Start 2P", monospace',
    fontSize: '9px',
};

const btnStyle: React.CSSProperties = {
    padding: '10px 20px',
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontFamily: '"Press Start 2P", monospace',
    fontSize: '10px',
    transition: 'all 0.2s',
};

export function VaultPanel() {
    const { t } = useTranslation();
    const [keys, setKeys] = useState<VaultKey[]>([]);
    const [showAdd, setShowAdd] = useState(false);
    const [form, setForm] = useState({ id: '', name: '', value: '', service: 'github' });

    const applyPreset = (preset: string) => {
        const presets: Record<string, { id: string; name: string; service: string }> = {
            hosting_domain: { id: 'hosting_domain', name: 'Hosting Domain', service: 'hosting' },
            hosting_ftp_host: { id: 'hosting_ftp_host', name: 'FTP Host/IP', service: 'hosting' },
            hosting_ftp_username: { id: 'hosting_ftp_username', name: 'FTP Username', service: 'hosting' },
            hosting_ftp_password: { id: 'hosting_ftp_password', name: 'FTP Password', service: 'hosting' },
            hosting_cpanel_host: { id: 'hosting_cpanel_host', name: 'cPanel Host (opcional)', service: 'cpanel' },
            hosting_cpanel_username: { id: 'hosting_cpanel_username', name: 'cPanel Username (opcional)', service: 'cpanel' },
            hosting_cpanel_password: { id: 'hosting_cpanel_password', name: 'cPanel Password (opcional)', service: 'cpanel' },
        };
        const p = presets[preset];
        if (!p) return;
        setForm({ id: p.id, name: p.name, value: '', service: p.service });
    };

    const fetchKeys = () => {
        fetch('http://localhost:3000/api/vault')
            .then(res => res.json())
            .then(data => setKeys(data));
    };

    useEffect(() => {
        fetchKeys();
    }, []);

    const handleSave = async () => {
        if (!form.id || !form.value) return;

        await fetch('http://localhost:3000/api/vault', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                key_id: form.id,
                key_name: form.name,
                key_value: form.value,
                service: form.service
            })
        });

        setForm({ id: '', name: '', value: '', service: 'github' });
        setShowAdd(false);
        fetchKeys();
    };

    return (
        <div style={panelStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
                <h2 style={{ fontSize: '14px', color: '#fbbf24' }}>🔒 {t('API Vault (Keys)')}</h2>
                <button
                    style={{ ...btnStyle, background: showAdd ? '#ef4444' : '#10b981' }}
                    onClick={() => setShowAdd(!showAdd)}
                >
                    {showAdd ? t('Cancel') : `+ ${t('Add Key')}`}
                </button>
            </div>

            {showAdd && (
                <div style={{ ...keyCardStyle, flexDirection: 'column', alignItems: 'flex-start' }}>
                    <label style={{ marginBottom: '8px' }}>{t('Quick Template (Hosting / cPanel):')}</label>
                    <select
                        style={inputStyle}
                        value=""
                        onChange={(e) => applyPreset(e.target.value)}
                    >
                        <option value="" disabled>{t('Select…')}</option>
                        <option value="hosting_domain">{t('Hosting: Domain')}</option>
                        <option value="hosting_ftp_host">{t('Hosting: FTP Host/IP')}</option>
                        <option value="hosting_ftp_username">{t('Hosting: FTP Username')}</option>
                        <option value="hosting_ftp_password">{t('Hosting: FTP Password')}</option>
                        <option value="hosting_cpanel_host">{t('cPanel: Host (optional)')}</option>
                        <option value="hosting_cpanel_username">{t('cPanel: Username (optional)')}</option>
                        <option value="hosting_cpanel_password">{t('cPanel: Password (optional)')}</option>
                    </select>

                    <label style={{ marginBottom: '8px' }}>{t('Key ID (e.g. github_token):')}</label>
                    <input
                        style={inputStyle}
                        value={form.id}
                        onChange={e => setForm({ ...form, id: e.target.value })}
                        placeholder={t('Unique ID in the system')}
                    />

                    <label style={{ marginBottom: '8px' }}>{t('Display Name (e.g. GitHub PAT):')}</label>
                    <input
                        style={inputStyle}
                        value={form.name}
                        onChange={e => setForm({ ...form, name: e.target.value })}
                        placeholder={t('Key name')}
                    />

                    <label style={{ marginBottom: '8px' }}>{t('Key Value (TOKEN/API KEY):')}</label>
                    <input
                        style={inputStyle}
                        type="password"
                        value={form.value}
                        onChange={e => setForm({ ...form, value: e.target.value })}
                        placeholder={t('Paste token…')}
                    />

                    <label style={{ marginBottom: '8px' }}>{t('Service:')}</label>
                    <select
                        style={inputStyle}
                        value={form.service}
                        onChange={e => setForm({ ...form, service: e.target.value })}
                    >
                        <option value="github">GitHub</option>
                        <option value="vercel">Vercel</option>
                        <option value="cloudflare">Cloudflare</option>
                        <option value="openai">OpenAI/OpenRouter</option>
                        <option value="hosting">Hosting (FTP)</option>
                        <option value="cpanel">cPanel</option>
                        <option value="other">{t('Other')}</option>
                    </select>

                    <button style={btnStyle} onClick={handleSave}>{t('Save to Vault')}</button>
                </div>
            )}

            <div style={{ marginTop: '20px' }}>
                {keys.length === 0 ? (
                    <div style={{ textAlign: 'center', opacity: 0.5, marginTop: '40px' }}>
                        {t('Vault is empty. Add keys so agents can deploy.')}
                    </div>
                ) : (
                    keys.map(k => (
                        <div key={k.key_id} style={keyCardStyle}>
                            <div>
                                <div style={{ fontSize: '11px', color: '#fbbf24', marginBottom: '5px' }}>
                                    {k.key_name} ({k.service.toUpperCase()})
                                </div>
                                <div style={{ fontSize: '8px', opacity: 0.6 }}>
                                    {t('ID')}: {k.key_id} • {t('Added at')} {new Date(k.created_at).toLocaleDateString()}
                                </div>
                            </div>
                            <div style={{ color: '#10b981' }}>{t('Protected')} 🛡️</div>
                        </div>
                    ))
                )}
            </div>

            <div style={{ marginTop: '40px', padding: '15px', background: 'rgba(251, 191, 36, 0.1)', border: '1px solid #fbbf24', borderRadius: '4px' }}>
                <p style={{ lineHeight: '1.6', color: '#fbbf24' }}>
                    ℹ️ {t('Vault info')}
                </p>
                <div style={{ marginTop: '12px', lineHeight: '1.8', color: '#fbbf24' }}>
                    {t('Hosting/FTP (for deploy):')} hosting_domain, hosting_ftp_host, hosting_ftp_username, hosting_ftp_password
                    <br />
                    {t('cPanel (optional, for subdomains/email):')} hosting_cpanel_host, hosting_cpanel_username, hosting_cpanel_password
                </div>
            </div>
        </div>
    );
}
