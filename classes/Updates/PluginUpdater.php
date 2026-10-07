<?php

declare(strict_types=1);

namespace Grav\Plugin\BadgerBuilder\Updates;

use Grav\Common\Cache;
use Grav\Common\Grav;
use Grav\Plugin\Api\Services\GpmService;
use Symfony\Component\Yaml\Yaml;

/**
 * Check / download / install Badger Builder from a private Gitea Release zip.
 */
final class PluginUpdater
{
    private const SLUG = 'badger-builder';

    private Grav $grav;

    /** @var array<string, mixed> */
    private array $updatesConfig;

    public function __construct(?Grav $grav = null)
    {
        $this->grav = $grav ?? Grav::instance();
        $plugin = $this->grav['config']->get('plugins.badger-builder') ?? [];
        $this->updatesConfig = is_array($plugin['updates'] ?? null) ? $plugin['updates'] : [];
    }

    public function updatesEnabled(): bool
    {
        return (bool) ($this->updatesConfig['enabled'] ?? true);
    }

    public function client(): GiteaReleaseClient
    {
        return new GiteaReleaseClient($this->updatesConfig);
    }

    public function currentVersion(): string
    {
        $path = $this->pluginPath() . '/blueprints.yaml';
        if (!is_file($path)) {
            return '0.0.0';
        }

        try {
            $data = Yaml::parseFile($path);
            if (is_array($data) && isset($data['version'])) {
                return VersionComparator::normalize((string) $data['version']);
            }
        } catch (\Throwable) {
            // fall through
        }

        return '0.0.0';
    }

    /**
     * @return array{
     *   configured: bool,
     *   enabled: bool,
     *   current: string,
     *   latest: string|null,
     *   update_available: bool,
     *   release_name: string|null,
     *   body: string|null,
     *   asset_name: string|null,
     *   tag: string|null,
     *   prerelease: bool,
     *   message: string|null
     * }
     */
    public function check(?string $tag = null): array
    {
        $current = $this->currentVersion();
        $base = [
            'configured' => false,
            'enabled' => $this->updatesEnabled(),
            'current' => $current,
            'latest' => null,
            'update_available' => false,
            'release_name' => null,
            'body' => null,
            'asset_name' => null,
            'tag' => null,
            'prerelease' => false,
            'message' => null,
        ];

        if (!$this->updatesEnabled()) {
            $base['message'] = 'Private updates are disabled in plugin settings.';

            return $base;
        }

        $client = $this->client();
        $base['configured'] = $client->isConfigured();
        if (!$base['configured']) {
            $base['message'] = 'Set Gitea base URL, owner, repo, and access token in plugin settings (or site config).';

            return $base;
        }

        $release = $tag !== null && $tag !== ''
            ? $client->releaseByTag($tag)
            : $client->latestRelease();

        if ($release === null) {
            $base['message'] = 'No matching Gitea release with a curated zip asset was found.';

            return $base;
        }

        $base['latest'] = $release['version'];
        $base['release_name'] = $release['name'];
        $base['body'] = $release['body'];
        $base['asset_name'] = $release['asset_name'];
        $base['tag'] = $release['tag'];
        $base['prerelease'] = $release['prerelease'];
        $base['update_available'] = VersionComparator::isNewer($release['version'], $current);

        if (!$base['update_available']) {
            $base['message'] = 'Badger Builder is up to date.';
        }

        return $base;
    }

    /**
     * Download + install the latest (or tagged) release zip.
     *
     * @return array{ok:bool,version:string|null,message:string}
     */
    public function apply(?string $tag = null): array
    {
        if (!$this->updatesEnabled()) {
            return ['ok' => false, 'version' => null, 'message' => 'Private updates are disabled.'];
        }

        $pluginDir = $this->pluginPath();
        if (is_link($pluginDir) || (function_exists('is_link') && is_link(rtrim($pluginDir, '/')))) {
            return [
                'ok' => false,
                'version' => null,
                'message' => 'Cannot update: plugin directory is a symlink.',
            ];
        }

        $client = $this->client();
        if (!$client->isConfigured()) {
            return [
                'ok' => false,
                'version' => null,
                'message' => 'Gitea updates are not configured (token / repo missing).',
            ];
        }

        $release = $tag !== null && $tag !== ''
            ? $client->releaseByTag($tag)
            : $client->latestRelease();

        if ($release === null) {
            return [
                'ok' => false,
                'version' => null,
                'message' => 'No installable Gitea release asset found.',
            ];
        }

        $current = $this->currentVersion();
        if (!VersionComparator::isNewer($release['version'], $current)
            && ($tag === null || $tag === '')
        ) {
            return [
                'ok' => true,
                'version' => $current,
                'message' => 'Already on the latest version (' . $current . ').',
            ];
        }

        $tmpRoot = $this->tempDir() . '/bb-update-' . uniqid('', false);
        if (!mkdir($tmpRoot, 0775, true) && !is_dir($tmpRoot)) {
            return ['ok' => false, 'version' => null, 'message' => 'Could not create temp directory.'];
        }

        $zipPath = $tmpRoot . '/' . $release['asset_name'];

        try {
            $client->downloadAsset($release['asset_id'], $zipPath);
            $this->assertValidPackageZip($zipPath);

            if (!class_exists(GpmService::class)) {
                throw new \RuntimeException('API plugin GpmService is not available.');
            }

            $result = GpmService::directInstall($zipPath);
            if ($result !== true) {
                $msg = is_string($result) ? $result : 'Install failed.';
                throw new \RuntimeException($msg);
            }

            Cache::clearCache();

            $installed = $this->currentVersion();

            return [
                'ok' => true,
                'version' => $installed,
                'message' => 'Updated Badger Builder to ' . $installed . '.',
            ];
        } catch (\Throwable $e) {
            return [
                'ok' => false,
                'version' => null,
                'message' => $e->getMessage(),
            ];
        } finally {
            $this->deleteTree($tmpRoot);
        }
    }

    private function pluginPath(): string
    {
        $locator = $this->grav['locator'];
        $path = $locator->findResource('plugins://' . self::SLUG, true, true);
        if (!is_string($path) || $path === '') {
            $userDir = defined('USER_DIR') ? rtrim(USER_DIR, '/') : dirname(__DIR__, 3);
            $path = $userDir . '/plugins/' . self::SLUG;
        }

        return rtrim($path, '/');
    }

    private function tempDir(): string
    {
        $tmp = $this->grav['locator']->findResource('tmp://', true, true);
        if (!is_string($tmp) || $tmp === '') {
            $tmp = sys_get_temp_dir();
        }

        return rtrim($tmp, '/');
    }

    private function assertValidPackageZip(string $zipPath): void
    {
        if (!is_file($zipPath) || filesize($zipPath) < 64) {
            throw new \RuntimeException('Downloaded package is empty or missing.');
        }

        $zip = new \ZipArchive();
        if ($zip->open($zipPath) !== true) {
            throw new \RuntimeException('Downloaded file is not a valid zip.');
        }

        $hasBlueprint = false;
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $name = $zip->getNameIndex($i);
            if (!is_string($name)) {
                continue;
            }
            $norm = str_replace('\\', '/', $name);
            if ($norm === self::SLUG . '/blueprints.yaml' || str_ends_with($norm, '/' . self::SLUG . '/blueprints.yaml')) {
                $hasBlueprint = true;
                break;
            }
            // Also accept blueprints at package root if Grav flattened — but we require slug folder.
            if ($norm === self::SLUG . '/badger-builder.php') {
                $hasBlueprint = true;
                break;
            }
        }
        $zip->close();

        if (!$hasBlueprint) {
            throw new \RuntimeException(
                'Zip must contain a top-level "' . self::SLUG . '/" folder with blueprints.yaml.'
            );
        }
    }

    private function deleteTree(string $path): void
    {
        if (!file_exists($path)) {
            return;
        }
        if (is_file($path) || is_link($path)) {
            @unlink($path);

            return;
        }

        $items = @scandir($path);
        if ($items === false) {
            return;
        }
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $this->deleteTree($path . '/' . $item);
        }
        @rmdir($path);
    }
}
