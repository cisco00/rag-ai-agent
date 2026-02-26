const apiKey = 'test-key';
const options = {};
const { params, headers, ...customConfig } = options;

const config = {
    ...customConfig,
    headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-KEY': apiKey } : {}),
        ...headers,
    },
    body: new FormData(),
};

if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
    config.body = JSON.stringify(config.body);
}

if (config.body instanceof FormData) {
    const newHeaders = { ...config.headers };
    delete newHeaders['Content-Type'];
    config.headers = newHeaders;
}

console.log(config.headers);
