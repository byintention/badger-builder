<?php

declare(strict_types=1);

namespace Grav\Plugin\BadgerBuilder;

use Grav\Common\Grav;
use Grav\Common\Inflector;

/**
 * Section panel definitions — loaded from Local YAML via PanelLoader.
 */
class PanelRegistry
{
    /**
     * @return array<string, array<string, mixed>>
     */
    public static function all(): array
    {
        return PanelLoader::load();
    }

    /**
     * Clear in-process cache after Local YAML changes.
     */
    public static function reset(): void
    {
        PanelLoader::reset();
    }

    /**
     * @param array<int, string>|null $enabledIds
     * @return list<array<string, mixed>>
     */
    public static function enabled(?array $enabledIds = null): array
    {
        $all = self::all();
        if ($enabledIds === null || $enabledIds === []) {
            return array_values($all);
        }

        $out = [];
        foreach ($enabledIds as $id) {
            if (isset($all[$id])) {
                $out[] = $all[$id];
            }
        }

        return $out;
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function get(string $id): ?array
    {
        return self::all()[$id] ?? null;
    }

    /**
     * Default values for a new section of the given panel.
     *
     * @return array<string, mixed>
     */
    public static function defaults(string $panelId): array
    {
        $panel = self::get($panelId);
        if (!$panel) {
            return ['panel' => $panelId];
        }

        $section = [
            'panel' => $panelId,
        ];

        foreach ($panel['fields'] as $field) {
            $name = $field['name'] ?? null;
            if (!$name || isset($section[$name])) {
                continue;
            }
            if ($field['type'] === 'list') {
                $section[$name] = [];
            } elseif (isset($field['default'])) {
                $section[$name] = $field['default'];
            } else {
                $section[$name] = '';
            }
        }

        return $section;
    }

    /**
     * Background colour select options: Transparent + active theme colours.
     *
     * @return array<string, string> value => label
     */
    public static function backgroundOptions(): array
    {
        $options = [
            'transparent' => 'Transparent',
        ];

        $grav = Grav::instance();
        $theme = (string) ($grav['config']->get('system.pages.theme') ?? '');
        if ($theme === '') {
            return $options;
        }

        $colours = $grav['config']->get('themes.' . $theme . '.colours');
        if (!is_array($colours)) {
            return $options;
        }

        foreach ($colours as $row) {
            if (!is_array($row)) {
                continue;
            }
            $label = trim((string) ($row['label'] ?? ''));
            if ($label === '') {
                continue;
            }
            $slug = Inflector::hyphenize($label);
            if ($slug === '' || $slug === 'transparent') {
                continue;
            }
            $options[$slug] = $label;
        }

        return $options;
    }

    /**
     * Apply dynamic background options to panel field schemas.
     *
     * @param list<array<string, mixed>> $panels
     * @return list<array<string, mixed>>
     */
    public static function withBackgroundOptions(array $panels): array
    {
        $options = self::backgroundOptions();

        foreach ($panels as &$panel) {
            if (!isset($panel['fields']) || !is_array($panel['fields'])) {
                continue;
            }
            foreach ($panel['fields'] as &$field) {
                $name = (string) ($field['name'] ?? '');
                if ($name === '' || !str_ends_with($name, '_background')) {
                    continue;
                }
                if (($field['type'] ?? '') !== 'select') {
                    continue;
                }
                $field['options'] = $options;
            }
            unset($field);
        }
        unset($panel);

        return $panels;
    }
}
