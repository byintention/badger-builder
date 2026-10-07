<?php

declare(strict_types=1);

namespace Grav\Plugin\BadgerBuilder;

use Grav\Common\Grav;
use Grav\Common\Markdown\Parsedown;
use Grav\Common\Markdown\ParsedownExtra;
use Grav\Common\Page\Interfaces\PageInterface;
use Grav\Common\Page\Markdown\Excerpts;
use Grav\Common\Utils;

/**
 * Panel body processing — HTML from Modern Editor, or Markdown for legacy content.
 */
class MarkdownHelper
{
    /**
     * Render panel body HTML.
     *
     * TinyMCE (markdown_enabled: false) stores HTML. Older content may still be
     * Markdown — detect and run Parsedown only for that path.
     */
    public static function process(string $string, bool $block = true, ?PageInterface $page = null): string
    {
        if (self::looksLikeHtml($string)) {
            return self::processShortcodes(self::absoluteizeMediaUrls($string));
        }

        $grav = Grav::instance();
        $page ??= $grav['page'] ?? null;

        $markdown = (array) $grav['config']->get('system.pages.markdown', []);
        $markdown['escape_markup'] = false;
        $markdown['special_chars'] = [];

        $defaults = [
            'markdown' => $markdown,
            'images' => $grav['config']->get('system.images', []),
        ];

        $extra = $markdown['extra'] ?? false;
        $excerpts = new Excerpts($page, $defaults);

        $parsedown = $extra ? new ParsedownExtra($excerpts) : new Parsedown($excerpts);

        $html = $block ? $parsedown->text($string) : $parsedown->line($string);

        return self::processShortcodes(self::absoluteizeMediaUrls($html));
    }

    /**
     * Run shortcode-core handlers when that plugin is available.
     * No-op otherwise so panel bodies stay valid without the dependency.
     */
    private static function processShortcodes(string $html): string
    {
        if ($html === '') {
            return '';
        }

        $grav = Grav::instance();
        if (!isset($grav['shortcode']) || !is_object($grav['shortcode'])) {
            return $html;
        }

        $manager = $grav['shortcode'];
        if (!method_exists($manager, 'processShortcodes')) {
            return $html;
        }

        return (string) $manager->processShortcodes($html);
    }

    /**
     * Rewrite root-relative site/page media URLs to absolute for front-end output.
     * Stored content stays portable (no hostname).
     */
    public static function absoluteizeMediaUrls(string $html): string
    {
        if ($html === '' || !str_contains($html, 'src=')) {
            return $html;
        }

        return (string) preg_replace_callback(
            '#\bsrc=(["\'])(/?(?:user/media/|user/pages/)[^"\']+)\1#i',
            static function (array $m): string {
                $quote = $m[1];
                $path = $m[2];
                if (!str_starts_with($path, '/')) {
                    $path = '/' . $path;
                }
                $path = self::encodeUrlPath($path);
                $absolute = Utils::url($path, true, true);
                if (!is_string($absolute) || $absolute === '') {
                    $absolute = $path;
                }

                return 'src=' . $quote . self::encodeUrlPath($absolute) . $quote;
            },
            $html
        );
    }

    /**
     * Percent-encode each URL path segment (spaces, unicode) without double-encoding.
     */
    public static function encodeUrlPath(string $url): string
    {
        if ($url === '') {
            return '';
        }

        $hash = '';
        $hashPos = strpos($url, '#');
        if ($hashPos !== false) {
            $hash = substr($url, $hashPos);
            $url = substr($url, 0, $hashPos);
        }

        $query = '';
        $queryPos = strpos($url, '?');
        if ($queryPos !== false) {
            $query = substr($url, $queryPos);
            $url = substr($url, 0, $queryPos);
        }

        $prefix = '';
        if (preg_match('#^(https?:)?//[^/]+#i', $url, $m)) {
            $prefix = $m[0];
            $url = substr($url, strlen($m[0]));
        }

        $encoded = implode('/', array_map(static function (string $seg): string {
            if ($seg === '') {
                return '';
            }

            return rawurlencode(rawurldecode($seg));
        }, explode('/', $url)));

        return $prefix . $encoded . $query . $hash;
    }

    /**
     * True when the value is already HTML (e.g. TinyMCE output starting with a tag).
     */
    public static function looksLikeHtml(string $string): bool
    {
        $trimmed = ltrim($string);

        return $trimmed !== '' && $trimmed[0] === '<';
    }
}
