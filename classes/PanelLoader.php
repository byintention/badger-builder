<?php

declare(strict_types=1);

namespace Grav\Plugin\BadgerBuilder;

use Grav\Common\Grav;
use Symfony\Component\Yaml\Exception\ParseException;
use Symfony\Component\Yaml\Yaml;

/**
 * Load and merge panel schemas from plugin → user/data → theme (Local YAML).
 */
class PanelLoader
{
    /** @var array<string, array<string, mixed>>|null */
    private static ?array $cache = null;

    private static ?string $fingerprint = null;

    /**
     * @return array<string, array<string, mixed>>
     */
    public static function load(): array
    {
        $fingerprint = self::fingerprint();
        if (self::$cache !== null && self::$fingerprint === $fingerprint) {
            return self::$cache;
        }

        $panels = [];
        foreach (self::directories() as $dir) {
            if ($dir === '' || !is_dir($dir)) {
                continue;
            }
            self::mergeDirectory($dir, $panels);
        }

        self::$cache = $panels;
        self::$fingerprint = $fingerprint;

        return $panels;
    }

    /**
     * Clear in-process cache (tests / after writes).
     */
    public static function reset(): void
    {
        self::$cache = null;
        self::$fingerprint = null;
    }

    /**
     * Ordered load directories: plugin builtins, user/data, active theme.
     *
     * @return list<string>
     */
    public static function directories(): array
    {
        $grav = Grav::instance();
        $config = $grav['config'];
        $local = (array) ($config->get('plugins.badger-builder.local_panels') ?? []);

        if (array_key_exists('enabled', $local) && !$local['enabled']) {
            // Still load plugin builtins so the site keeps working.
            return [self::pluginPanelsDir()];
        }

        $dataPath = trim((string) ($local['data_path'] ?? 'badger-builder/panels'), '/');
        $themePath = trim((string) ($local['theme_path'] ?? 'badger-builder/panels'), '/');

        $dirs = [self::pluginPanelsDir()];

        $userDir = defined('USER_DIR') ? rtrim(USER_DIR, '/') : dirname(__DIR__, 3);
        $dataDir = $userDir . '/data/' . $dataPath;
        $dirs[] = $dataDir;

        $theme = (string) ($config->get('system.pages.theme') ?? '');
        if ($theme !== '') {
            $dirs[] = $userDir . '/themes/' . $theme . '/' . $themePath;
        }

        return $dirs;
    }

    private static function pluginPanelsDir(): string
    {
        return dirname(__DIR__) . '/panels';
    }

    /**
     * @param array<string, array<string, mixed>> $panels
     */
    private static function mergeDirectory(string $dir, array &$panels): void
    {
        $files = glob($dir . '/*.yaml') ?: [];
        sort($files, SORT_STRING);

        foreach ($files as $file) {
            $panel = self::parseFile($file);
            if ($panel === null) {
                continue;
            }
            $id = (string) $panel['id'];
            $panels[$id] = $panel;
        }
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function parseFile(string $file): ?array
    {
        try {
            $data = Yaml::parseFile($file);
        } catch (ParseException $e) {
            self::log('Badger Builder: failed to parse panel YAML ' . $file . ': ' . $e->getMessage());

            return null;
        }

        if (!is_array($data)) {
            self::log('Badger Builder: panel YAML must be a mapping: ' . $file);

            return null;
        }

        $id = trim((string) ($data['id'] ?? pathinfo($file, PATHINFO_FILENAME)));
        if ($id === '') {
            self::log('Badger Builder: panel YAML missing id: ' . $file);

            return null;
        }

        if (!isset($data['fields']) || !is_array($data['fields'])) {
            self::log('Badger Builder: panel YAML missing fields: ' . $file);

            return null;
        }

        $data['id'] = $id;
        $data['label'] = (string) ($data['label'] ?? $id);
        $data['twig'] = (string) ($data['twig'] ?? $id);
        $data['schema'] = (int) ($data['schema'] ?? 1);
        $data['modified'] = (int) ($data['modified'] ?? filemtime($file) ?: 0);

        return $data;
    }

    private static function fingerprint(): string
    {
        $parts = [];
        foreach (self::directories() as $dir) {
            if ($dir === '' || !is_dir($dir)) {
                $parts[] = $dir . ':missing';
                continue;
            }
            $max = 0;
            foreach (glob($dir . '/*.yaml') ?: [] as $file) {
                $mtime = (int) (filemtime($file) ?: 0);
                if ($mtime > $max) {
                    $max = $mtime;
                }
            }
            $parts[] = $dir . ':' . $max;
        }

        return implode('|', $parts);
    }

    private static function log(string $message): void
    {
        try {
            $grav = Grav::instance();
            if (isset($grav['debugger'])) {
                $grav['debugger']->addMessage($message);
            }
        } catch (\Throwable) {
            // Grav may not be fully booted in edge cases.
        }
    }
}
