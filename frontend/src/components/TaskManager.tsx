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

export function TaskManager({ onClose }: { onClose: () => void }) {
    const { t } = useTranslation();
    const [tasks, setTasks] = useState<any[]>([]);
    const [newTaskDesc, setNewTaskDesc] = useState('');

    const fetchTasks = () => {
        fetch('http://localhost:3000/api/tasks')
            .then(res => res.json())
            .then(data => setTasks(data))
            .catch(console.error);
    };

    useEffect(() => {
        fetchTasks();
    }, []);

    const handleCreateTask = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTaskDesc) return;

        await fetch('http://localhost:3000/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent_id: null, description: newTaskDesc })
        });
        setNewTaskDesc('');
        fetchTasks();
    };

    return (
        <div style={panelStyle}>
            <button style={{ float: 'right', ...btnStyle }} onClick={onClose}>{t('Close')}</button>
            <h2 style={titleStyle}>{t('Task Manager')}</h2>

            <form onSubmit={handleCreateTask} style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
                <input
                    type="text"
                    value={newTaskDesc}
                    onChange={e => setNewTaskDesc(e.target.value)}
                    placeholder={t('Task command')}
                    style={{ flex: 1, padding: '8px', fontSize: '18px', background: 'var(--pixel-bg)', border: '2px solid var(--pixel-border)', color: 'var(--pixel-text)' }}
                />
                <button type="submit" style={{ ...btnStyle, marginBottom: 0 }}>{t('Create Task')}</button>
            </form>

            <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', color: 'var(--pixel-text)' }}>
                <thead>
                    <tr style={{ borderBottom: '2px solid var(--pixel-border)' }}>
                        <th>{t('ID')}</th>
                        <th>{t('Agent')}</th>
                        <th>{t('Description')}</th>
                        <th>{t('Status')}</th>
                        <th>{t('Created At')}</th>
                    </tr>
                </thead>
                <tbody>
                    {tasks.map(t => (
                        <tr key={t.id} style={{ borderBottom: '1px solid var(--pixel-border)' }}>
                            <td style={{ padding: '8px' }}>{t.id.slice(-6)}</td>
                            <td>{t.agent_name || 'System'}</td>
                            <td>{t.description}</td>
                            <td>{t.status}</td>
                            <td>{new Date(t.created_at).toLocaleString()}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
