import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fallbackDataDir = path.join(__dirname, '../../data');
const dataDir = fs.existsSync('/data') ? '/data' : fallbackDataDir;
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'orchestrator.db');
let db = new Database(dbPath);

export function initDb() {
    try {
        db.pragma('journal_mode = DELETE');
    } catch (e: any) {
        const code = (e?.code || '').toString();
        if (code === 'SQLITE_IOERR_SHMOPEN') {
            const suffixes = ['', '-wal', '-shm'];
            for (const s of suffixes) {
                const p = `${dbPath}${s}`;
                try {
                    if (fs.existsSync(p)) {
                        const bak = `${p}.bak_${Date.now()}`;
                        fs.renameSync(p, bak);
                    }
                } catch (_err) { }
            }
            try { db.close(); } catch (_err) { }
            db = new Database(dbPath);
            db.pragma('journal_mode = DELETE');
        } else {
            throw e;
        }
    }

    // Agents table
    db.exec(`
        CREATE TABLE IF NOT EXISTS agents (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            role TEXT NOT NULL,
            system_prompt TEXT,
            permissions TEXT, -- JSON array of allowed commands/network
            llm_model TEXT,
            llm_api_key TEXT,
            division_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            memory TEXT -- JSON string for short/long term memory
        );
    `);

    // Add columns dynamically for simple migration if they don't exist
    try {
        db.exec("ALTER TABLE agents ADD COLUMN llm_model TEXT;");
    } catch (e) { /* ignore if exists */ }
    try {
        db.exec("ALTER TABLE agents ADD COLUMN llm_api_key TEXT;");
    } catch (e) { /* ignore if exists */ }
    try {
        db.exec("ALTER TABLE agents ADD COLUMN llm_base_url TEXT;");
    } catch (e) { /* ignore if exists */ }
    try {
        db.exec("ALTER TABLE agents ADD COLUMN system_prompt TEXT;");
    } catch (e) { /* ignore if exists */ }
    try {
        db.exec("ALTER TABLE agents ADD COLUMN focus_goal TEXT;");
    } catch (e) { /* ignore if exists */ }
    try {
        db.exec("ALTER TABLE agents ADD COLUMN github_token TEXT;");
    } catch (e) { /* ignore if exists */ }
    try {
        db.exec("ALTER TABLE agents ADD COLUMN division_id TEXT;");
    } catch (e) { /* ignore if exists */ }

    // Table for Long-term Company Memory (Knowledge Base)
    db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge_base (
            id TEXT PRIMARY KEY,
            category TEXT, -- 'business_plan', 'market_research', 'tech_stack'
            title TEXT,
            content TEXT,
            author_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Tasks table
    db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            agent_id TEXT,
            division_id TEXT,
            description TEXT NOT NULL,
            status TEXT DEFAULT 'pending', -- pending, running, waiting_approval, done, error, completed
            schedule TEXT, -- cron string if scheduled
            logs TEXT, -- JSON array of job logs
            depends_on TEXT, -- ID of another task that must be 'completed' before this one runs
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(agent_id) REFERENCES agents(id),
            FOREIGN KEY(depends_on) REFERENCES tasks(id)
        );
    `);
    try {
        db.exec("ALTER TABLE tasks ADD COLUMN division_id TEXT;");
    } catch (e) { /* ignore if exists */ }
    try {
        db.exec("ALTER TABLE tasks ADD COLUMN depends_on TEXT;");
    } catch (e) { /* ignore if exists */ }

    // Divisions table (Objectives / Projects)
    db.exec(`
        CREATE TABLE IF NOT EXISTS divisions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            objective_prompt TEXT NOT NULL,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Approvals table
    db.exec(`
        CREATE TABLE IF NOT EXISTS approvals (
            id TEXT PRIMARY KEY,
            task_id TEXT,
            agent_id TEXT,
            action_type TEXT NOT NULL, -- e.g., 'command', 'network', 'file'
            action_data TEXT, -- JSON payload of the action details
            status TEXT DEFAULT 'pending', -- pending, approved, rejected
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(task_id) REFERENCES tasks(id)
        );
    `);

    // Messages table (inter-agent chat)
    db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            from_agent_id TEXT,
            to_agent_id TEXT,
            content TEXT NOT NULL,
            type TEXT DEFAULT 'chat',
            read INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Tool aliases (agent-defined compatibility wrappers)
    db.exec(`
        CREATE TABLE IF NOT EXISTS tool_aliases (
            alias TEXT PRIMARY KEY,
            target TEXT NOT NULL,
            config TEXT, -- JSON: { map: {dest: [src...]}, defaults: {}, passthrough: boolean }
            created_by TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS agent_finance (
            agent_id TEXT PRIMARY KEY,
            bank_balance REAL DEFAULT 0.0,
            salary REAL DEFAULT 20.0,
            last_payroll_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(agent_id) REFERENCES agents(id)
        );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS agent_transactions (
            id TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL,
            tx_type TEXT NOT NULL,
            amount REAL NOT NULL,
            memo TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(agent_id) REFERENCES agents(id)
        );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS upgrades (
            upgrade_key TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            cost REAL NOT NULL,
            weight_bonus INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS agent_upgrades (
            agent_id TEXT NOT NULL,
            upgrade_key TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY(agent_id, upgrade_key),
            FOREIGN KEY(agent_id) REFERENCES agents(id),
            FOREIGN KEY(upgrade_key) REFERENCES upgrades(upgrade_key)
        );
    `);

    // Company Profile table
    db.exec(`
        CREATE TABLE IF NOT EXISTS company (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            mission TEXT,
            cash REAL DEFAULT 1000.0,
            api_keys TEXT -- JSON (deprecating in favor of vault)
        );
    `);

    // Vault table for API Keys and Credentials
    db.exec(`
        CREATE TABLE IF NOT EXISTS vault (
            key_id TEXT PRIMARY KEY,
            key_name TEXT NOT NULL,
            key_value TEXT NOT NULL,
            service TEXT NOT NULL, -- github, vercel, cloudflare, etc
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Ensure a default company exists
    const hasCompany = db.prepare('SELECT id FROM company LIMIT 1').get();
    if (!hasCompany) {
        db.prepare('INSERT INTO company (id, name, mission, cash, api_keys) VALUES (?, ?, ?, ?, ?)').run(
            'default',
            'Pixels Office Empire',
            'Operar um escritório virtual de agentes autônomos para executar projetos e gerar resultado no mundo real.',
            1000.0,
            '{}'
        );
    } else {
        try {
            const company = db.prepare("SELECT cash FROM company WHERE id = 'default'").get() as any;
            const cash = Number(company?.cash ?? 0);
            if (!Number.isFinite(cash) || cash < 1000) {
                db.prepare("UPDATE company SET cash = 1000.0 WHERE id = 'default'").run();
            }
        } catch (e) { }
    }

    try {
        const count = db.prepare('SELECT COUNT(1) as c FROM upgrades').get() as any;
        if (Number(count?.c || 0) === 0) {
            db.prepare('INSERT INTO upgrades (upgrade_key, title, description, cost, weight_bonus) VALUES (?, ?, ?, ?, ?)').run(
                'extra_turns_1',
                'Upgrade: +1 turno',
                'O agente passa a agir mais vezes no loop (mais poder computacional).',
                50.0,
                1
            );
            db.prepare('INSERT INTO upgrades (upgrade_key, title, description, cost, weight_bonus) VALUES (?, ?, ?, ?, ?)').run(
                'extra_turns_2',
                'Upgrade: +2 turnos',
                'Ainda mais turnos no loop, prioridade maior para execução.',
                120.0,
                2
            );
        }
    } catch (e) { }

    console.log('[Database] Initialized SQLite schema at', dbPath);
    return db;
}

export { db };
