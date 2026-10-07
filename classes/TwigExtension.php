<?php

declare(strict_types=1);

namespace Grav\Plugin\BadgerBuilder;

use Grav\Common\Page\Interfaces\PageInterface;
use Grav\Common\Page\Media;
use Grav\Common\Page\Medium\Medium;
use Grav\Common\Utils;
use Twig\Extension\AbstractExtension;
use Twig\TwigFilter;
use Twig\TwigFunction;

class TwigExtension extends AbstractExtension
{
    public function getFilters(): array
    {
        return [
            new TwigFilter('bb_markdown', [$this, 'markdownFilter'], [
                'needs_context' => true,
                'is_safe' => ['html'],
            ]),
            new TwigFilter('bb_absolute_url', [$this, 'absoluteUrlFilter']),
        ];
    }

    public function getFunctions(): array
    {
        return [
            new TwigFunction('bb_site_media', [$this, 'siteMediaFunction'], [
                'needs_context' => true,
            ]),
            new TwigFunction('bb_absolute_url', [$this, 'absoluteUrlFilter']),
        ];
    }

    /**
     * Render a panel body (HTML from Modern Editor, or legacy Markdown).
     *
     * @param array<string, mixed> $context
     */
    public function markdownFilter(array $context, ?string $string, bool $block = true): string
    {
        if ($string === null || $string === '') {
            return '';
        }

        $page = $context['page'] ?? null;

        return MarkdownHelper::process($string, $block, $page instanceof PageInterface ? $page : null);
    }

    /**
     * Resolve a site-media relative path (or legacy page-media filename) to a Medium.
     *
     * @param array<string, mixed> $context
     */
    public function siteMediaFunction(array $context, ?string $path): ?Medium
    {
        if ($path === null || $path === '') {
            return null;
        }

        $path = str_replace('\\', '/', $path);
        $path = ltrim($path, '/');

        // Strip accidental /user/media/ prefix from stored values.
        if (str_starts_with($path, 'user/media/')) {
            $path = substr($path, strlen('user/media/'));
        }

        // Stored paths may be percent-encoded (TinyMCE src); disk paths use real spaces.
        $path = implode('/', array_map('rawurldecode', explode('/', $path)));

        $userDir = defined('USER_DIR') ? rtrim(USER_DIR, '/') : '';
        if ($userDir !== '') {
            $full = $userDir . '/media/' . $path;
            if (is_file($full)) {
                $dir = dirname($full);
                $base = basename($full);
                $media = new Media($dir);
                $medium = $media[$base] ?? null;
                if ($medium instanceof Medium) {
                    return $medium;
                }
            }
        }

        $page = $context['page'] ?? null;
        if ($page instanceof PageInterface) {
            $base = basename($path);
            $medium = $page->media()[$base] ?? null;
            if ($medium instanceof Medium) {
                return $medium;
            }
        }

        return null;
    }

    /**
     * Make a URL absolute using the live Grav base (domain-portable storage).
     */
    public function absoluteUrlFilter(?string $url): string
    {
        if ($url === null || $url === '') {
            return '';
        }

        $url = MarkdownHelper::encodeUrlPath($url);

        // External non-media URLs left alone; media hosts re-based to current site.
        if (preg_match('#^https?://#i', $url) || str_starts_with($url, '//')) {
            $parts = parse_url($url);
            $path = is_array($parts) ? ($parts['path'] ?? '') : '';
            if ($path !== '' && (str_contains($path, '/user/media/') || str_contains($path, '/user/pages/'))) {
                $url = $path . (isset($parts['query']) ? '?' . $parts['query'] : '');
            } else {
                return $url;
            }
        }

        $resolved = Utils::url($url, true, true);

        $out = is_string($resolved) ? $resolved : $url;

        return MarkdownHelper::encodeUrlPath($out);
    }
}
