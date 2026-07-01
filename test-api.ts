import axios from 'axios';

async fun run() {
    try {
        const res = await axios.get('http://localhost:5000/api/config/workspace', {
            headers: { 'x-country-code': 'ZA' }
        });
        console.log(JSON.stringify(res.data, null, 2));
    } catch (e) {
        console.error("API Call failed. Is the server running?");
    }
}

run();
