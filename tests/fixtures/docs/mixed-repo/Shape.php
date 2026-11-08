<?php

/**
 * A shape with a width.
 */
class Shape
{
    /**
     * Returns the area.
     *
     * @param int $w The width.
     * @return int The area.
     */
    public function area(int $w): int
    {
        return $w * $w;
    }

    public function perimeter(int $w): int
    {
        return 4 * $w;
    }

    private function secret(): void
    {
    }
}
