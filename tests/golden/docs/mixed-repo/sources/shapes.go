package shapes

// Area returns the area of a rectangle.
func Area(w, h int) int {
	return w * h
}

// Perimeter TODO: state what this does, in one active-voice sentence.
func Perimeter(w, h int) int {
	return 2 * (w + h)
}

type (
	// Point is a position.
	Point struct {
		X, Y int
	}

	// Size TODO: state what this does, in one active-voice sentence.
	Size struct {
		W, H int
	}
)
