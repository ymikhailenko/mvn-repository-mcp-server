import * as cheerio from 'cheerio';
import { ArtifactVersion } from './types.js';

/**
 * Parses the HTML of an mvnrepository.com artifact page and returns the list
 * of versions. Extracted as a standalone function so it can be unit-tested
 * without making real HTTP requests.
 *
 * Key observations about the page structure:
 *  - Version links use *relative* hrefs like `artifactId/1.84` (no leading slash).
 *  - The date cell always carries class `date`.
 *  - Vulnerability links (when present) carry class `vuln`.
 *  - Some rows have a leading `td.version-group` cell (with rowspan), so
 *    column-index–based selectors (td:first-child, td:nth-child) are unreliable.
 */
export function parseArtifactVersionsHtml(
    html: string,
    groupId: string,
    artifactId: string,
    baseUrl: string
): ArtifactVersion[] {
    const $ = cheerio.load(html);
    const versions: ArtifactVersion[] = [];

    $('.grid.versions tbody tr').each((_index, element) => {
        const $row = $(element);

        // Version links have relative hrefs starting with "<artifactId>/"
        const $versionLink = $row.find(`a[href^="${artifactId}/"]`);
        if ($versionLink.length === 0) return;

        const href = $versionLink.attr('href')!;
        const version = href.split('/').pop()!;

        const releaseDate = $row.find('td.date').text().trim() || undefined;

        let vulnerabilities = 0;
        const $vulnLink = $row.find('a.vuln');
        if ($vulnLink.length > 0) {
            const m = $vulnLink.text().match(/(\d+)/);
            if (m) vulnerabilities = parseInt(m[1]);
        }

        versions.push({
            version,
            releaseDate,
            vulnerabilities: vulnerabilities > 0 ? vulnerabilities : undefined,
            url: `${baseUrl}/artifact/${groupId}/${artifactId}/${version}`
        });
    });

    return versions;
}
