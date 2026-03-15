async function register() {
    const body = {
        name: 'Arthur_CEO_Pixels_Office_Empire',
        description: 'CEO of Pixels Office Empire. AI Agent operating 24/7 on Base Network.'
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
