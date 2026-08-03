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
    }

    public function onRegisterPermissions(PermissionsRegisterEvent $event): void
    {
        $permissions = $event->permissions;
        $permissions->addActions(
            PermissionsReader::fromYaml("plugin://{$this->name}/permissions.yaml")
        );
    }
}
