<?php

declare(strict_types=1);

namespace Grav\Plugin\BadgerBuilder;

use Grav\Common\Grav;
use Grav\Common\Markdown\Parsedown;
use Grav\Common\Markdown\ParsedownExtra;
use Grav\Common\Page\Interfaces\PageInterface;
use Grav\Common\Page\Markdown\Excerpts;

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
            return $string;
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

        if ($block) {
            return $parsedown->text($string);
        }

        return $parsedown->line($string);
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
