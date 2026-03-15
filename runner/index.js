const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));

const WORKSPACE_DIR = '/workspace';

// Ensure the requested path is inside the workspace
function resolveSafePath(requestedPath) {
    const rawPath = path.isAbsolute(requestedPath) ? requestedPath : path.join(WORKSPACE_DIR, requestedPath);
    const normalizedPath = path.normalize(rawPath);
    if (!normalizedPath.startsWith(WORKSPACE_DIR)) {
        throw new Error("Access denied: Path is outside the workspace folder.");
    }
    return normalizedPath;
}

app.post('/execute', (req, res) => {
    const { command, timeoutMs = 60000 } = req.body;
    if (!command) return res.status(400).send({ error: 'Command required' });

    console.log(`[Execute] ${command}`);

    // Execute command with timeout and inside workspace
    exec(command, { cwd: WORKSPACE_DIR, timeout: timeoutMs }, (error, stdout, stderr) => {
        res.send({
            exitCode: error ? error.code || 1 : 0,
            stdout: stdout || '',
            stderr: stderr || '',
            error: error ? error.message : null
        });
    });
});

app.post('/write_file', (req, res) => {
    try {
        const { filePath, content } = req.body;
        const safePath = resolveSafePath(filePath);

        fs.mkdirSync(path.dirname(safePath), { recursive: true });
        fs.writeFileSync(safePath, content, 'utf8');

        console.log(`[WriteFile] Written ${safePath}`);
        res.send({ success: true, path: safePath });
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

app.post('/read_file', (req, res) => {
    try {
        const { filePath } = req.body;
        const safePath = resolveSafePath(filePath);

        if (!fs.existsSync(safePath)) {
            return res.status(404).send({ error: 'File not found' });
        }

        const content = fs.readFileSync(safePath, 'utf8');
        res.send({ success: true, content });
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

const PORT = 4000;
app.listen(PORT, () => {
    console.log(`[Runner] Sandbox Executor running on port ${PORT}`);
    console.log(`[Runner] Workspace mounted at ${WORKSPACE_DIR}`);
});
