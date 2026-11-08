# A shape with a width.
class Shape
  # Returns the area.
  #
  # @param w [Integer] The width.
  # @return [Integer] The area.
  def area(w)
    w * w
  end

  def perimeter(w)
    4 * w
  end

  private

  def secret; end
end
