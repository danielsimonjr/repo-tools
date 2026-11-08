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

    /**
     * TODO: state what this does, in one active-voice sentence.
     *
     * @param $w TODO: state what it is. Do not repeat the type.
     * @return TODO: state what the caller gets back.
     */
    public function perimeter(int $w): int
    {
        return 4 * $w;
    }

    private function secret(): void
    {
    }
}
