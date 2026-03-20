import React, { useEffect, useState } from 'react';

const hudStyle: React.CSSProperties = {
    position: 'absolute',
    top: '15px',
    right: '15px',
    background: 'rgba(10, 15, 30, 0.85)',
    border: '3px solid var(--pixel-accent)',
    borderRadius: '8px',
    padding: '10px 20px',
    color: '#fff',
    fontFamily: '"Courier New", Courier, monospace',
    fontSize: '22px',
    fontWeight: 'bold',
    zIndex: 100,
    boxShadow: '4px 4px 0px rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
    backdropFilter: 'blur(4px)'
};

export function CompanyHud() {
    const [cash, setCash] = useState<number>(0);

    const fetchCompanyData = async () => {
        try {
            const res = await fetch('http://localhost:3000/api/company');
            if (res.ok) {
                const data = await res.json();
                setCash(Number(data?.cash || 0));
            }
        } catch (e) {}
    };

    useEffect(() => {
        fetchCompanyData();
        const interval = setInterval(fetchCompanyData, 10000); // Polling a cada 10s
        return () => clearInterval(interval);
    }, []);

    return (
        <div style={hudStyle}>
            <span style={{ fontSize: '28px' }}>💰</span>
            <span>Caixa: <span style={{ color: '#5cf' }}>${cash.toFixed(2)}</span></span>
        </div>
    );
}
