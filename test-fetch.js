const fs = require('fs');

async function testFetch() {
    const formData = new FormData();
    // using fetch API's FormData

    // Wait, in Node v18+ fetch is native, but FormData from files is tricky
    // Let's use string Blob
    formData.append('file', new Blob(['name,age\nAlice,30'], { type: 'text/csv' }), 'test.csv');

    const config = {
        method: 'POST',
        headers: {
            'X-API-KEY': '2shFOhR1FCGCjUlk5NFZ-LuDwT7W7ueGxWNtWcOjIH0'
        },
        body: formData
    };

    try {
        const res = await fetch('http://127.0.0.1:8000/analyze-file', config);
        const text = await res.text();
        console.log('Status:', res.status);
        console.log('Response:', text);
    } catch (err) {
        console.error('Fetch error:', err);
    }
}

testFetch();
