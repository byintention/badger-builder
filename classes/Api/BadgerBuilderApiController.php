<?php

declare(strict_types=1);

namespace Grav\Plugin\BadgerBuilder\Api;

use Grav\Plugin\Api\Controllers\AbstractApiController;
use Grav\Plugin\Api\Response\ApiResponse;
use Grav\Plugin\BadgerBuilder\PanelRegistry;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

class BadgerBuilderApiController extends AbstractApiController
{
    /**
     * GET /badger-builder/panels
     */
    public function panels(ServerRequestInterface $request): ResponseInterface
    {
        $this->requirePermission($request, 'api.pages.read');

        $enabled = $this->enabledPanelIds();

        $panels = PanelRegistry::withBackgroundOptions(PanelRegistry::enabled($enabled));

        return ApiResponse::create([
            'panels' => $panels,
        ]);
    }

    /**
     * @deprecated Use panels(); kept for older admin field bundles.
     */
    public function layouts(ServerRequestInterface $request): ResponseInterface
    {
        $this->requirePermission($request, 'api.pages.read');

        $enabled = $this->enabledPanelIds();
        $panels = PanelRegistry::withBackgroundOptions(PanelRegistry::enabled($enabled));

        return ApiResponse::create([
            'panels' => $panels,
            'layouts' => $panels,
        ]);
    }

    /**
     * GET /badger-builder/config
     */
    public function config(ServerRequestInterface $request): ResponseInterface
    {
        $this->requirePermission($request, 'api.access');

        $plugin = $this->config->get('plugins.badger-builder') ?? [];
        $enabled = $this->enabledPanelIds($plugin);
        $defaultPanel = $plugin['default_panel'] ?? $plugin['default_layout'] ?? 'text';
        if (!in_array($defaultPanel, $enabled, true)) {
            $defaultPanel = $enabled[0] ?? 'text';
        }

        $showPanelLabels = $plugin['show_panel_labels'] ?? $plugin['show_layout_labels'] ?? true;

        return ApiResponse::create([
            'enabled_panels' => $enabled,
            'default_panel' => $defaultPanel,
            'show_panel_labels' => (bool) $showPanelLabels,
            'built_in_css' => (bool) ($plugin['built_in_css'] ?? true),
            'editor_css' => $this->resolveThemeEditorCssUrl(),
        ]);
    }

    /**
     * Public URL for active theme css/editor.css when the file exists.
     */
    private function resolveThemeEditorCssUrl(): ?string
    {
        $theme = (string) ($this->config->get('system.pages.theme') ?? '');
        if ($theme === '' || !preg_match('/^[A-Za-z0-9_-]+$/', $theme)) {
            return null;
        }

        $userDir = defined('USER_DIR') ? rtrim(USER_DIR, '/') : dirname(__DIR__, 4);
        $relative = 'user/themes/' . $theme . '/css/editor.css';
        $path = $userDir . '/themes/' . $theme . '/css/editor.css';
        if (!is_file($path)) {
            return null;
        }

        $base = rtrim((string) ($this->grav['base_url_relative'] ?? ''), '/');

        return ($base === '' ? '' : $base) . '/' . $relative;
    }

    /**
     * @param array<string, mixed>|null $plugin
     * @return list<string>
     */
    private function enabledPanelIds(?array $plugin = null): array
    {
        if ($plugin === null) {
            $plugin = $this->config->get('plugins.badger-builder') ?? [];
        }

        $enabled = $plugin['enabled_panels'] ?? $plugin['enabled_layouts'] ?? ['hero', 'features', 'text'];
        if (!is_array($enabled) || $enabled === []) {
            $enabled = ['hero', 'features', 'text'];
        }

        return $enabled;
    }
}
