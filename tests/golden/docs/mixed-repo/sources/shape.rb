# A shape with a width.
class Shape
  # Returns the area.
  #
  # @param w [Integer] The width.
  # @return [Integer] The area.
  def area(w)
    w * w
  end

  # TODO: state what this does, in one active-voice sentence.
  # @param w TODO: state what it is. Do not repeat the type.
  # @return TODO: state what the caller gets back.
  def perimeter(w)
    4 * w
  end

  private

  def secret; end
end
