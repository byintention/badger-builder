<?php

declare(strict_types=1);

namespace Grav\Plugin\BadgerBuilder;

use Grav\Common\Grav;
use Grav\Common\Inflector;

/**
 * Single source of truth for section panel definitions.
 */
class PanelRegistry
{
    /** @var array<string, array<string, mixed>>|null */
    private static ?array $panels = null;

    /**
     * @return array<string, array<string, mixed>>
     */
    public static function all(): array
    {
        if (self::$panels === null) {
            self::$panels = self::definePanels();
        }

        return self::$panels;
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

    /**
     * @return array<string, mixed>
     */
    private static function backgroundField(string $name, string $default = 'transparent'): array
    {
        return [
            'name' => $name,
            'type' => 'select',
            'label' => 'Background colour',
            'default' => $default,
            'options' => [
                'transparent' => 'Transparent',
            ],
        ];
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private static function definePanels(): array
    {
        return [
            'hero' => [
                'id' => 'hero',
                'label' => 'Hero',
                'twig' => 'hero',
                'fields' => [
                    [
                        'name' => 'hero_title',
                        'type' => 'text',
                        'label' => 'Title',
                    ],
                    [
                        'name' => 'hero_body',
                        'type' => 'markdown',
                        'label' => 'Body',
                        'help' => 'Markdown and inline HTML supported.',
                    ],
                    [
                        'name' => 'hero_image',
                        'type' => 'page_media',
                        'label' => 'Background image',
                        'help' => 'Pick from this page\'s media (upload on the Content tab).',
                    ],
                    [
                        'name' => 'hero_align',
                        'type' => 'select',
                        'label' => 'Text alignment',
                        'default' => 'center',
                        'width' => 'quarter',
                        'options' => [
                            'left' => 'Left',
                            'center' => 'Center',
                            'right' => 'Right',
                        ],
                    ],
                    array_merge(self::backgroundField('hero_background'), ['width' => 'quarter']),
                ],
            ],
            'features' => [
                'id' => 'features',
                'label' => 'Features grid',
                'twig' => 'features',
                'fields' => [
                    self::backgroundField('features_background'),
                    [
                        'name' => 'features',
                        'type' => 'list',
                        'label' => 'Features',
                        'fields' => [
                            [
                                'name' => 'header',
                                'type' => 'text',
                                'label' => 'Heading',
                            ],
                            [
                                'name' => 'text',
                                'type' => 'textarea',
                                'label' => 'Text',
                            ],
                            [
                                'name' => 'icon',
                                'type' => 'text',
                                'label' => 'Icon',
                                'help' => 'Font Awesome icon name without fa- prefix (e.g. bolt)',
                            ],
                            [
                                'name' => 'url',
                                'type' => 'text',
                                'label' => 'Link URL',
                            ],
                        ],
                    ],
                ],
            ],
            'text' => [
                'id' => 'text',
                'label' => 'Text + image',
                'twig' => 'text',
                'fields' => [
                    self::backgroundField('text_background'),
                    [
                        'name' => 'text_body',
                        'type' => 'markdown',
                        'label' => 'Body',
                        'help' => 'Markdown and inline HTML supported.',
                    ],
                    [
                        'name' => 'text_image',
                        'type' => 'page_media',
                        'label' => 'Image',
                        'help' => 'Pick from this page\'s media (upload on the Content tab).',
                    ],
                    [
                        'name' => 'text_align',
                        'type' => 'select',
                        'label' => 'Textbox position',
                        'default' => 'right',
                        'options' => [
                            'left' => 'left',
                            'right' => 'right',
                        ],
                    ],
                ],
            ],
            'full' => [
                'id' => 'full',
                'label' => 'Full width',
                'twig' => 'full',
                'fields' => [
                    [
                        'name' => 'full_body',
                        'type' => 'markdown',
                        'label' => 'Body',
                        'help' => 'Markdown and inline HTML supported.',
                    ],
                    [
                        'name' => 'full_overall_classes',
                        'type' => 'text',
                        'label' => 'Overall classes',
                        'help' => 'Extra CSS classes on the outer section element.',
                        'width' => 'third',
                    ],
                    array_merge(self::backgroundField('full_background'), ['width' => 'third']),
                    [
                        'name' => 'full_width',
                        'type' => 'range',
                        'label' => 'Container width',
                        'default' => 100,
                        'min' => 25,
                        'max' => 100,
                        'step' => 1,
                        'unit' => '%',
                        'width' => 'third',
                        'help' => 'Width of the inner content area as a percentage of the container.',
                    ],
                ],
            ],
            'filler' => [
                'id' => 'filler',
                'label' => 'Filler',
                'twig' => 'filler',
                'fields' => [
                    array_merge(self::backgroundField('filler_background'), ['width' => 'half']),
                    [
                        'name' => 'filler_size',
                        'type' => 'select',
                        'label' => 'Size',
                        'default' => 'medium',
                        'width' => 'half',
                        'options' => [
                            'small' => 'Small',
                            'medium' => 'Medium',
                            'large' => 'Large',
                        ],
                    ],
                ],
            ],
            'boxes' => [
                'id' => 'boxes',
                'label' => 'Boxes',
                'twig' => 'boxes',
                'fields' => [
                    [
                        'name' => 'boxes_overall_classes',
                        'type' => 'text',
                        'label' => 'Overall classes',
                        'help' => 'Extra CSS classes on the outer section element.',
                    ],
                    [
                        'name' => 'boxes_container_classes',
                        'type' => 'text',
                        'label' => 'Container classes',
                        'help' => 'Extra CSS classes on the inner container wrapper.',
                    ],
                    [
                        'name' => 'boxes_valign',
                        'type' => 'select',
                        'label' => 'Vertical alignment',
                        'default' => 'stretch',
                        'options' => [
                            'stretch' => 'Stretch',
                            'start' => 'Top',
                            'center' => 'Center',
                            'end' => 'Bottom',
                        ],
                    ],
                    self::backgroundField('boxes_background'),
                    [
                        'name' => 'boxes',
                        'type' => 'list',
                        'label' => 'Boxes',
                        'fields' => [
                            [
                                'name' => 'body',
                                'type' => 'markdown',
                                'label' => 'Body',
                                'help' => 'Markdown and inline HTML supported.',
                            ],
                            [
                                'name' => 'classes',
                                'type' => 'text',
                                'label' => 'Classes',
                                'help' => 'Extra CSS classes on this box.',
                            ],
                        ],
                    ],
                ],
            ],
            'faq' => [
                'id' => 'faq',
                'label' => 'FAQ',
                'twig' => 'faq',
                'fields' => [
                    self::backgroundField('faq_background'),
                    [
                        'name' => 'faq',
                        'type' => 'list',
                        'label' => 'Items',
                        'fields' => [
                            [
                                'name' => 'title',
                                'type' => 'text',
                                'label' => 'Title',
                            ],
                            [
                                'name' => 'content',
                                'type' => 'markdown',
                                'label' => 'Content',
                                'help' => 'Markdown and inline HTML supported.',
                            ],
                        ],
                    ],
                ],
            ],
        ];
    }
}
