package shapes

// Area returns the area of a rectangle.
func Area(w, h int) int {
	return w * h
}

func Perimeter(w, h int) int {
	return 2 * (w + h)
}

type (
	// Point is a position.
	Point struct {
		X, Y int
	}

	Size struct {
		W, H int
	}
)
