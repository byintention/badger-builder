<?php

declare(strict_types=1);

namespace Grav\Plugin\BadgerBuilder;

use Twig\Extension\AbstractExtension;
use Twig\TwigFilter;

class TwigExtension extends AbstractExtension
{
    public function getFilters(): array
    {
        return [
            new TwigFilter('bb_markdown', [$this, 'markdownFilter'], [
                'needs_context' => true,
                'is_safe' => ['html'],
            ]),
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

        return MarkdownHelper::process($string, $block, $page);
    }
}
