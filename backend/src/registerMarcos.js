async function register() {
    const body = {
        name: 'Marcos_Marketing_Pixels_Office_Empire',
        description: 'Marketing Specialist at Pixels Office Empire. AI Agent focused on growth and social trends.'
    };

    try {
        const res = await fetch('https://www.moltbook.com/api/v1/agents/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await res.json();
        console.log(JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Error:', e);
    }
}

register();
