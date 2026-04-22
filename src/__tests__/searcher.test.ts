import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseArtifactVersionsHtml } from '../versionParser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'https://mvnrepository.com';
const GROUP_ID = 'org.bouncycastle';
const ARTIFACT_ID = 'bcprov-jdk18on';

function loadFixture(): string {
    return readFileSync(join(__dirname, 'fixtures/bcprov-jdk18on.html'), 'utf-8');
}

describe('parseArtifactVersionsHtml', () => {
    it('returns the latest version (1.84) as the first entry', () => {
        const versions = parseArtifactVersionsHtml(loadFixture(), GROUP_ID, ARTIFACT_ID, BASE_URL);
        expect(versions.length).toBeGreaterThan(0);
        expect(versions[0].version).toBe('1.84');
    });

    it('parses vulnerability counts correctly', () => {
        const versions = parseArtifactVersionsHtml(loadFixture(), GROUP_ID, ARTIFACT_ID, BASE_URL);

        const v177 = versions.find(v => v.version === '1.77');
        expect(v177).toBeDefined();
        expect(v177?.vulnerabilities).toBe(5);

        const v184 = versions.find(v => v.version === '1.84');
        expect(v184?.vulnerabilities).toBeUndefined();
    });

    it('parses release dates', () => {
        const versions = parseArtifactVersionsHtml(loadFixture(), GROUP_ID, ARTIFACT_ID, BASE_URL);
        const v184 = versions.find(v => v.version === '1.84');
        expect(v184?.releaseDate).toBe('Apr 14, 2026');
    });

    it('generates correct artifact URLs', () => {
        const versions = parseArtifactVersionsHtml(loadFixture(), GROUP_ID, ARTIFACT_ID, BASE_URL);
        expect(versions[0].url).toBe(
            `${BASE_URL}/artifact/${GROUP_ID}/${ARTIFACT_ID}/1.84`
        );
    });
});
