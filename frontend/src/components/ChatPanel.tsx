import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatEntry } from '../hooks/useExtensionMessages.js';

const panelStyle: React.CSSProperties = {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: '40px',
    width: '340px',
    background: 'rgba(10, 15, 30, 0.92)',
    borderLeft: '2px solid var(--pixel-border)',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 50,
    fontFamily: '"Press Start 2P", monospace',
    fontSize: '10px',
};

const headerStyle: React.CSSProperties = {
    padding: '10px 12px',
    borderBottom: '2px solid var(--pixel-border)',
    color: 'var(--pixel-text)',
    fontSize: '14px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
};

const logStyle: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: '8px',
};

const msgStyle = (type: string, agentId?: string): React.CSSProperties => {
    const isInvestor = agentId === 'INVESTOR';
    return {
        padding: '6px 8px',
        marginBottom: '6px',
        borderRadius: '4px',
        background: isInvestor
            ? 'rgba(255, 215, 0, 0.15)'
            : type === 'approval'
                ? 'rgba(255, 80, 80, 0.15)'
                : type === 'thought'
                    ? 'rgba(100, 200, 255, 0.08)'
                    : 'rgba(80, 255, 120, 0.1)',
        borderLeft: isInvestor
            ? '3px solid #ffd700'
            : type === 'approval'
                ? '3px solid #ff5050'
                : type === 'thought'
                    ? '3px solid #64c8ff'
                    : '3px solid #50ff78',
        wordBreak: 'break-word' as const,
        ...(isInvestor ? {
            boxShadow: '0 0 8px rgba(255, 215, 0, 0.3)',
            border: '1px solid rgba(255, 215, 0, 0.4)',
        } : {}),
    };
};

const inputAreaStyle: React.CSSProperties = {
    padding: '8px',
    borderTop: '2px solid var(--pixel-border)',
    display: 'flex',
    gap: '4px',
};

const inputStyle: React.CSSProperties = {
    flex: 1,
    padding: '6px 8px',
    fontSize: '10px',
    background: 'rgba(20, 30, 50, 0.8)',
    border: '1px solid var(--pixel-border)',
    color: 'var(--pixel-text)',
    fontFamily: '"Press Start 2P", monospace',
};

const sendBtnStyle: React.CSSProperties = {
    padding: '6px 12px',
    fontSize: '10px',
    background: 'var(--pixel-accent, #4488ff)',
    color: '#fff',
    border: 'none',
    cursor: 'pointer',
    fontFamily: '"Press Start 2P", monospace',
};

interface ChatPanelProps {
    chatLog: ChatEntry[];
    onClose: () => void;
}

export function ChatPanel({ chatLog, onClose }: ChatPanelProps) {
    const { t } = useTranslation();
    const [input, setInput] = useState('');
    const [targetAgent, setTargetAgent] = useState('');
    const [agents, setAgents] = useState<Array<{ id: string; name: string; role: string }>>([]);
    const logEndRef = useRef<HTMLDivElement>(null);

    // Fetch agents for the dropdown
    useEffect(() => {
        fetch('http://localhost:3000/api/agents')
            .then(r => r.json())
            .then(data => setAgents(data))
            .catch(console.error);
    }, []);

    // Auto-scroll to bottom
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatLog]);

    const handleSend = async () => {
        if (!input.trim() || !targetAgent) return;

        await fetch('http://localhost:3000/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to_agent_id: targetAgent, content: input })
        });

        setInput('');
    };

    const typeEmoji = (type: string) => {
        if (type === 'approval') return '🔴';
        if (type === 'thought') return '🧠';
        return '💬';
    };

    return (
        <div style={panelStyle}>
            <div style={headerStyle}>
                <span>💬 {t('Office Chat')}</span>
                <button
                    style={{ background: 'none', border: 'none', color: 'var(--pixel-text)', cursor: 'pointer', fontSize: '16px' }}
                    onClick={onClose}
                >×</button>
            </div>

            <div style={logStyle}>
                {chatLog.length === 0 && (
                    <div style={{ color: 'var(--pixel-text-dim)', textAlign: 'center', padding: '20px' }}>
                        {t('No messages yet...')}
                        <br /><br />
                        {t('Configure agent API keys to start chatting!')} 🧠
                    </div>
                )}
                {chatLog.map((entry) => (
                    <div key={entry.id} style={msgStyle(entry.type, entry.agentId)}>
                        <div style={{ color: 'var(--pixel-text-dim)', marginBottom: '3px' }}>
                            {typeEmoji(entry.type)} <strong style={{ color: entry.agentId === 'INVESTOR' ? '#ffd700' : entry.type === 'approval' ? '#ff5050' : '#88ccff' }}>
                                {entry.agentName}
                            </strong>
                            <span style={{ float: 'right', opacity: 0.5 }}>{entry.timestamp}</span>
                        </div>
                        <div style={{ color: entry.agentId === 'INVESTOR' ? '#ffd700' : 'var(--pixel-text)' }}>
                            {entry.content}
                        </div>
                    </div>
                ))}
                <div ref={logEndRef} />
            </div>

            <div style={inputAreaStyle}>
                <select
                    style={{ ...inputStyle, flex: 'none', width: '100px' }}
                    value={targetAgent}
                    onChange={e => setTargetAgent(e.target.value)}
                >
                    <option value="">{t('To...')}</option>
                    {agents.map(a => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                </select>
                <input
                    style={inputStyle}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSend()}
                    placeholder={t('Message...')}
                />
                <button style={sendBtnStyle} onClick={handleSend}>
                    {t('Send') || '➤'}
                </button>
            </div>
        </div>
    );
}
