<?php

declare(strict_types=1);

namespace Grav\Plugin\BadgerBuilder\Updates;

/**
 * Semver helpers for Gitea tags (v1.2.3) vs blueprints.yaml versions.
 */
final class VersionComparator
{
    public static function normalize(string $version): string
    {
        $version = trim($version);
        if ($version !== '' && ($version[0] === 'v' || $version[0] === 'V')) {
            $version = substr($version, 1);
        }

        return $version;
    }

    /**
     * @return int same semantics as version_compare(): -1 / 0 / 1
     */
    public static function compare(string $a, string $b): int
    {
        return version_compare(self::normalize($a), self::normalize($b));
    }

    public static function isNewer(string $candidate, string $current): bool
    {
        return self::compare($candidate, $current) === 1;
    }
}
