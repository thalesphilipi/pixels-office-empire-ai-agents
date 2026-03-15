import { db } from './backend/src/db.js';

function seedCPanel() {
    try {
        // cPanel Account
        db.prepare("INSERT OR REPLACE INTO vault (key_id, key_name, key_value, service) VALUES (?, ?, ?, ?)").run(
            'cpanel_user',
            'cPanel Username',
            '',
            'hosting'
        );
        db.prepare("INSERT OR REPLACE INTO vault (key_id, key_name, key_value, service) VALUES (?, ?, ?, ?)").run(
            'cpanel_pass',
            'cPanel Password',
            '',
            'hosting'
        );
        db.prepare("INSERT OR REPLACE INTO vault (key_id, key_name, key_value, service) VALUES (?, ?, ?, ?)").run(
            'cpanel_domain',
            'cPanel Primary Domain',
            '',
            'hosting'
        );
        db.prepare("INSERT OR REPLACE INTO vault (key_id, key_name, key_value, service) VALUES (?, ?, ?, ?)").run(
            'cpanel_host',
            'cPanel API Host',
            '',
            'hosting'
        );
        
        console.log('✅ cPanel credentials seeded into vault.');
    } catch (e) {
        console.error('❌ Error seeding cPanel credentials:', e);
    }
}

seedCPanel();
