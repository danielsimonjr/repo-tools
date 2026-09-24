export class Box {
  private value = 0;

  get size(): number {
    return this.value;
  }

  add(n: number): void {
    this.value += n;
  }
}