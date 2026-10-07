<?php

declare(strict_types=1);

namespace Grav\Plugin\BadgerBuilder\Updates;

/**
 * Minimal Gitea Releases API client (private repos via token).
 */
final class GiteaReleaseClient
{
    private string $baseUrl;
    private string $owner;
    private string $repo;
    private string $token;
    private string $assetPrefix;
    private bool $prerelease;

    /**
     * @param array<string, mixed> $config plugins.badger-builder.updates
     */
    public function __construct(array $config)
    {
        $this->baseUrl = rtrim((string) ($config['base_url'] ?? 'https://gitea.com'), '/');
        $this->owner = trim((string) ($config['owner'] ?? ''));
        $this->repo = trim((string) ($config['repo'] ?? ''));
        $this->token = trim((string) ($config['token'] ?? ''));
        $this->assetPrefix = (string) ($config['asset_prefix'] ?? 'badger-builder-');
        $this->prerelease = (bool) ($config['prerelease'] ?? false);
    }

    public function isConfigured(): bool
    {
        return $this->baseUrl !== ''
            && $this->owner !== ''
            && $this->repo !== ''
            && $this->token !== '';
    }

    /**
     * @return array{
     *   tag: string,
     *   version: string,
     *   name: string,
     *   body: string,
     *   prerelease: bool,
     *   asset_id: int,
     *   asset_name: string
     * }|null
     */
    public function latestRelease(): ?array
    {
        if (!$this->isConfigured()) {
            return null;
        }

        if ($this->prerelease) {
            $releases = $this->listReleases(30);
            $best = null;
            foreach ($releases as $release) {
                if (!empty($release['draft'])) {
                    continue;
                }
                $normalized = $this->normalizeRelease($release);
                if ($normalized === null) {
                    continue;
                }
                if ($best === null || VersionComparator::isNewer($normalized['version'], $best['version'])) {
                    $best = $normalized;
                }
            }

            return $best;
        }

        $release = $this->requestJson('GET', $this->apiPath('/releases/latest'));
        if (!is_array($release) || !empty($release['draft'])) {
            return null;
        }

        return $this->normalizeRelease($release);
    }

    /**
     * @return array{
     *   tag: string,
     *   version: string,
     *   name: string,
     *   body: string,
     *   prerelease: bool,
     *   asset_id: int,
     *   asset_name: string
     * }|null
     */
    public function releaseByTag(string $tag): ?array
    {
        $tag = trim($tag);
        if ($tag === '' || !$this->isConfigured()) {
            return null;
        }

        $release = $this->requestJson('GET', $this->apiPath('/releases/tags/' . rawurlencode($tag)));
        if (!is_array($release) || !empty($release['draft'])) {
            return null;
        }
        if (!$this->prerelease && !empty($release['prerelease'])) {
            return null;
        }

        return $this->normalizeRelease($release);
    }

    /**
     * Download release asset bytes via the API attachment endpoint (token auth).
     */
    public function downloadAsset(int $assetId, string $destinationPath): void
    {
        if (!$this->isConfigured()) {
            throw new \RuntimeException('Gitea updates are not configured.');
        }
        if ($assetId <= 0) {
            throw new \InvalidArgumentException('Invalid release asset id.');
        }

        $url = $this->apiPath('/releases/assets/' . $assetId);
        $body = $this->requestRaw('GET', $url, [
            'Accept: application/octet-stream',
        ]);

        $dir = dirname($destinationPath);
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new \RuntimeException('Could not create temp directory for download.');
        }

        if (file_put_contents($destinationPath, $body) === false) {
            throw new \RuntimeException('Could not write downloaded zip.');
        }
    }

    /**
     * @param array<string, mixed> $release
     * @return array{
     *   tag: string,
     *   version: string,
     *   name: string,
     *   body: string,
     *   prerelease: bool,
     *   asset_id: int,
     *   asset_name: string
     * }|null
     */
    private function normalizeRelease(array $release): ?array
    {
        $tag = (string) ($release['tag_name'] ?? '');
        $version = VersionComparator::normalize($tag);
        if ($version === '') {
            return null;
        }

        $asset = $this->pickAsset($release['assets'] ?? [], $version);
        if ($asset === null) {
            return null;
        }

        return [
            'tag' => $tag,
            'version' => $version,
            'name' => (string) ($release['name'] ?? $tag),
            'body' => (string) ($release['body'] ?? ''),
            'prerelease' => (bool) ($release['prerelease'] ?? false),
            'asset_id' => (int) $asset['id'],
            'asset_name' => (string) $asset['name'],
        ];
    }

    /**
     * @param mixed $assets
     * @return array{id:int,name:string}|null
     */
    private function pickAsset(mixed $assets, string $version): ?array
    {
        if (!is_array($assets)) {
            return null;
        }

        $exact = $this->assetPrefix . $version . '.zip';
        $fallback = null;

        foreach ($assets as $asset) {
            if (!is_array($asset)) {
                continue;
            }
            $name = (string) ($asset['name'] ?? '');
            $id = (int) ($asset['id'] ?? 0);
            if ($id <= 0 || $name === '') {
                continue;
            }
            if (!str_ends_with(strtolower($name), '.zip')) {
                continue;
            }
            if (!str_starts_with($name, $this->assetPrefix)) {
                continue;
            }
            if ($name === $exact) {
                return ['id' => $id, 'name' => $name];
            }
            if ($fallback === null) {
                $fallback = ['id' => $id, 'name' => $name];
            }
        }

        return $fallback;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function listReleases(int $limit): array
    {
        $path = $this->apiPath('/releases?limit=' . max(1, min(50, $limit)));
        $data = $this->requestJson('GET', $path);

        return is_array($data) ? $data : [];
    }

    private function apiPath(string $suffix): string
    {
        $suffix = '/' . ltrim($suffix, '/');

        return $this->baseUrl . '/api/v1/repos/' . rawurlencode($this->owner) . '/' . rawurlencode($this->repo) . $suffix;
    }

    /**
     * @param list<string> $extraHeaders
     * @return array<string, mixed>|list<mixed>|null
     */
    private function requestJson(string $method, string $url, array $extraHeaders = []): mixed
    {
        $raw = $this->requestRaw($method, $url, array_merge(['Accept: application/json'], $extraHeaders));
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw new \RuntimeException('Invalid JSON from Gitea API.');
        }

        return $decoded;
    }

    /**
     * @param list<string> $extraHeaders
     */
    private function requestRaw(string $method, string $url, array $extraHeaders = []): string
    {
        $headers = array_merge([
            'Authorization: token ' . $this->token,
            'User-Agent: BadgerBuilder-Updater',
        ], $extraHeaders);

        if (function_exists('curl_init')) {
            return $this->curlRequest($method, $url, $headers);
        }

        $context = stream_context_create([
            'http' => [
                'method' => $method,
                'header' => implode("\r\n", $headers),
                'timeout' => 60,
                'ignore_errors' => true,
            ],
            'ssl' => [
                'verify_peer' => true,
                'verify_peer_name' => true,
            ],
        ]);

        $body = @file_get_contents($url, false, $context);
        if ($body === false) {
            throw new \RuntimeException('Gitea request failed: ' . $url);
        }

        $status = 0;
        if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) {
            $status = (int) $m[1];
        }
        if ($status >= 400) {
            throw new \RuntimeException('Gitea API error HTTP ' . $status);
        }

        return $body;
    }

    /**
     * @param list<string> $headers
     */
    private function curlRequest(string $method, string $url, array $headers): string
    {
        $ch = curl_init($url);
        if ($ch === false) {
            throw new \RuntimeException('Could not initialize cURL.');
        }

        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_TIMEOUT => 120,
            CURLOPT_CONNECTTIMEOUT => 30,
        ]);

        $body = curl_exec($ch);
        $errno = curl_errno($ch);
        $error = curl_error($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($errno !== 0 || $body === false) {
            throw new \RuntimeException('Gitea request failed: ' . ($error !== '' ? $error : 'cURL error ' . $errno));
        }
        if ($status >= 400) {
            $detail = trim(mb_substr((string) $body, 0, 200));
            throw new \RuntimeException('Gitea API error HTTP ' . $status . ($detail !== '' ? ': ' . $detail : ''));
        }

        return (string) $body;
    }
}
