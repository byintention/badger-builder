<?php

declare(strict_types=1);

namespace Grav\Plugin;

use Composer\Autoload\ClassLoader;
use Grav\Common\Page\Types;
use Grav\Common\Plugin;
use Grav\Events\PermissionsRegisterEvent;
use Grav\Framework\Acl\PermissionsReader;
use Grav\Plugin\BadgerBuilder\TwigExtension as BadgerBuilderTwigExtension;
use RocketTheme\Toolbox\Event\Event;

class BadgerBuilderPlugin extends Plugin
{
    public static function getSubscribedEvents(): array
    {
        return [
            'onGetPageTemplates' => ['onGetPageTemplates', 0],
            'onTwigTemplatePaths' => ['onTwigTemplatePaths', -10],
            'onTwigExtensions' => ['onTwigExtensions', 0],
            'onPageInitialized' => ['onPageInitialized', 0],
            'onApiRegisterRoutes' => ['onApiRegisterRoutes', 0],
            'onApiSidebarItems' => ['onApiSidebarItems', 0],
            'onApiPluginPageInfo' => ['onApiPluginPageInfo', 0],
            'onApiFloatingWidgets' => ['onApiFloatingWidgets', 0],
            'onApiBlueprintResolved' => ['onApiBlueprintResolved', 0],
            PermissionsRegisterEvent::class => ['onRegisterPermissions', 0],
        ];
    }

    public function autoload(): ClassLoader
    {
        $loader = new ClassLoader();
        $loader->addPsr4('Grav\\Plugin\\BadgerBuilder\\', __DIR__ . '/classes');
        $loader->register();

        return $loader;
    }

    public function onGetPageTemplates(Event $event): void
    {
        /** @var Types $types */
        $types = $event->types;
        $types->register(
            'badger-builder',
            "plugins://{$this->name}/blueprints/pages/badger-builder.yaml"
        );
    }

    /**
     * Tell Grav the sections field stores an array (front matter validation).
     *
     * @return array<string, array<string, mixed>>
     */
    public function getFormFieldTypes(): array
    {
        return [
            'sections' => [
                'array' => true,
                'xss_check' => false,
            ],
        ];
    }

    public function onTwigTemplatePaths(): void
    {
        $paths = &$this->grav['twig']->twig_paths;

        // Theme Local templates: {theme}/badger-builder/templates/sections/*.html.twig
        // (sibling of local_panels.theme_path, default badger-builder/panels)
        $local = (array) ($this->config->get('plugins.badger-builder.local_panels') ?? []);
        $themePath = trim((string) ($local['theme_path'] ?? 'badger-builder/panels'), '/');
        $bbRoot = dirname($themePath);
        if ($bbRoot === '.' || $bbRoot === '') {
            $bbRoot = 'badger-builder';
        }

        $theme = (string) ($this->config->get('system.pages.theme') ?? '');
        if ($theme !== '') {
            $userDir = defined('USER_DIR') ? rtrim(USER_DIR, '/') : dirname(__DIR__, 2);
            $themeTemplates = $userDir . '/themes/' . $theme . '/' . $bbRoot . '/templates';
            if (is_dir($themeTemplates)) {
                array_unshift($paths, $themeTemplates);
            }
        }

        // Plugin page template (badger-builder.html.twig)
        $paths[] = __DIR__ . '/templates';
    }

    public function onTwigExtensions(): void
    {
        $this->grav['twig']->twig->addExtension(new BadgerBuilderTwigExtension());
    }

    public function onPageInitialized(): void
    {
        if ($this->isAdmin()) {
            return;
        }

        $page = $this->grav['page'];
        if ($page->template() !== 'badger-builder') {
            return;
        }

        if (!$this->config->get('plugins.badger-builder.built_in_css', true)) {
            return;
        }

        $this->grav['assets']->addCss('plugin://badger-builder/assets/css/badger-builder.css');
    }

    public function onApiRegisterRoutes(Event $event): void
    {
        $routes = $event['routes'];
        $controller = \Grav\Plugin\BadgerBuilder\Api\BadgerBuilderApiController::class;

        $routes->get('/badger-builder/panels', [$controller, 'panels']);
        $routes->get('/badger-builder/layouts', [$controller, 'layouts']);
        $routes->get('/badger-builder/config', [$controller, 'config']);
        $routes->get('/badger-builder/updates', [$controller, 'updates']);
        $routes->post('/badger-builder/updates/apply', [$controller, 'applyUpdate']);
    }

    public function onApiSidebarItems(Event $event): void
    {
        $items = $event['items'] ?? [];
        $items[] = [
            'id' => 'badger-builder',
            'plugin' => 'badger-builder',
            'label' => 'PLUGIN_BADGER_BUILDER.SIDEBAR',
            'icon' => 'fa-layer-group',
            'route' => '/plugin/badger-builder',
            'priority' => 24,
            'authorize' => 'admin.badger-builder.read',
        ];
        $event['items'] = $items;
    }

    public function onApiPluginPageInfo(Event $event): void
    {
        if (($event['plugin'] ?? null) !== 'badger-builder') {
            return;
        }

        $event['definition'] = [
            'id' => 'badger-builder',
            'plugin' => 'badger-builder',
            'title' => 'Badger Builder Updates',
            'icon' => 'fa-layer-group',
            'page_type' => 'component',
        ];
    }

    /**
     * Autoload a hidden widget on the Pages list so meta-description
     * traffic lights can be painted onto tree/list rows.
     */
    public function onApiFloatingWidgets(Event $event): void
    {
        $widgets = $event['widgets'] ?? [];
        $widgets[] = [
            'id' => 'badger-builder-meta-desc',
            'plugin' => 'badger-builder',
            'label' => $this->grav['language']->translate('PLUGIN_BADGER_BUILDER.META_DESCRIPTION'),
            'icon' => 'circle-dot',
            'showFab' => false,
            'autoLoad' => true,
            'routes' => ['/pages'],
            'priority' => 0,
            'authorize' => 'api.pages.read',
        ];
        $event['widgets'] = $widgets;
    }

    /**
     * Put meta description on a Metadata tab for every page template.
     */
    public function onApiBlueprintResolved(Event $event): void
    {
        if (($event['context'] ?? '') !== 'page') {
            return;
        }

        $fields = $event['fields'] ?? [];
        if (!is_array($fields)) {
            return;
        }

        $event['fields'] = $this->ensureMetadataTab($fields);
    }

    /**
     * @param array<int|string, mixed> $fields
     * @return array<int|string, mixed>
     */
    private function ensureMetadataTab(array $fields): array
    {
        $language = $this->grav['language'];
        $metaField = [
            'name' => 'header.metadata.description',
            'type' => 'meta_description',
            'label' => $language->translate('PLUGIN_BADGER_BUILDER.META_DESCRIPTION'),
            'help' => $language->translate('PLUGIN_BADGER_BUILDER.META_DESCRIPTION_HELP'),
            'rows' => 3,
        ];

        $this->stripMetaDescriptionFields($fields);

        foreach ($fields as &$field) {
            if (!is_array($field) || ($field['type'] ?? '') !== 'tabs' || !isset($field['fields']) || !is_array($field['fields'])) {
                continue;
            }

            $tabs = &$field['fields'];
            $metaIndex = null;
            $contentIndex = null;
            foreach ($tabs as $i => $tab) {
                if (!is_array($tab)) {
                    continue;
                }
                $name = (string) ($tab['name'] ?? '');
                if ($name === 'metadata') {
                    $metaIndex = $i;
                }
                if ($name === 'content') {
                    $contentIndex = $i;
                }
            }

            if ($metaIndex === null) {
                $newTab = [
                    'name' => 'metadata',
                    'type' => 'tab',
                    'title' => $language->translate('PLUGIN_BADGER_BUILDER.METADATA'),
                    'fields' => [$metaField],
                ];
                if ($contentIndex !== null) {
                    array_splice($tabs, (int) $contentIndex + 1, 0, [$newTab]);
                } else {
                    $tabs[] = $newTab;
                }
            } else {
                $existing = $tabs[$metaIndex]['fields'] ?? [];
                if (!is_array($existing)) {
                    $existing = [];
                }
                array_unshift($existing, $metaField);
                $tabs[$metaIndex]['fields'] = array_values($existing);
            }

            break;
        }
        unset($field);

        return $fields;
    }

    /**
     * @param array<int|string, mixed> $fields
     */
    private function stripMetaDescriptionFields(array &$fields): void
    {
        $kept = [];
        foreach ($fields as $field) {
            if (!is_array($field)) {
                continue;
            }
            if (($field['name'] ?? '') === 'header.metadata.description') {
                continue;
            }
            if (isset($field['fields']) && is_array($field['fields'])) {
                $this->stripMetaDescriptionFields($field['fields']);
            }
            $kept[] = $field;
        }
        $fields = $kept;
    }

    public function onRegisterPermissions(PermissionsRegisterEvent $event): void
    {
        $permissions = $event->permissions;
        $permissions->addActions(
            PermissionsReader::fromYaml("plugin://{$this->name}/permissions.yaml")
        );
    }
}
