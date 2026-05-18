const gridRaw = ` 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  5
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  5
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  5
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  5
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  5
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  5  5  5  5  5  5  5  5  5  9  9  9 10 10 10  9  9  9  4  4  4  4  4  4  4  4  4  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  5  0  5  5  0  5  5  0  5  9  9  9 10 10 10  9  9  9  4  4  4  4  4  4  4  4  4  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  5  5  5  5  5  5  5  5  5  9  9  9 10 10 10  9  9  9  4  4  4  4  4  4  4  4  4  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  5  5  5  9  9  9 10 10 10  9  9  9  4  4  4  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  5  0  5  9  9  9 10 10 10  9  9  9  4  4  4  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  5  5  5  9  9  9 10 10 10  9  9  9  4  4  4  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  5  5  5  9  9  9 10 10 10  9  9  9  4  4  4  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  5  0  5  9  9  9 10 10 10  9  9  9  4  4  4  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  5  5  5  9  9  9 10 10 10  9  9  9  4  4  4  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11 11 11 11 11 11 11 11 11  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11 11 11 11 11 11 11 11 11  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11 11 11 11 11 11 11 11 11  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11 11 11  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11 11 11  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11 11 11  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11 11 11  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11 11 11  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11 11 11  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 10 10 10  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9  9 11
 5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5  5 11`;

const grid = gridRaw.split("\n").map(v =>
  v
    .split(" ")
    .filter(v => v.length !== 0)
    .map(v => Number(v))
);

interface ShapeMetadata {
  id: number;
  color: number;
  x: number;
  y: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  count: number;
  width: number;
  height: number;
  holes: number;
  holeContent: number | null;
}

function findShapes(frame: number[][][]): Array<ShapeMetadata> {
  if (!frame || frame.length === 0) return [];

  const grid = frame[0];
  const rows = grid.length;
  const cols = grid[0].length;
  const visited = new Uint8Array(rows * cols);
  const shapes: Array<ShapeMetadata> = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const color = grid[r][c];
      const idx = r * cols + c;
      if (color === 9 || visited[idx]) continue; // Ignore background and already visited

      // Start BFS/DFS for a new shape
      const shape: ShapeMetadata = {
        id: shapes.length,
        color,
        x: c,
        y: r,
        minX: c,
        minY: r,
        maxX: c,
        maxY: r,
        count: 0,
        width: 0,
        height: 0,
        holes: 0,
        holeContent: null,
      };
      const stack: [number, number][] = [[r, c]];
      visited[idx] = 1;

      while (stack.length > 0) {
        const [currR, currC] = stack.pop()!;

        shape.minX = Math.min(shape.minX, currC);
        shape.minY = Math.min(shape.minY, currR);
        shape.maxX = Math.max(shape.maxX, currC);
        shape.maxY = Math.max(shape.maxY, currR);
        shape.count++;

        // Neighbors
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            // if (Math.abs(dr) + Math.abs(dc) > 1) continue; // 4-way only
            const nr = currR + dr;
            const nc = currC + dc;
            const nIdx = nr * cols + nc;

            if (
              nr >= 0 &&
              nr < rows &&
              nc >= 0 &&
              nc < cols &&
              !visited[nIdx] &&
              grid[nr][nc] === color
            ) {
              visited[nIdx] = 1;
              stack.push([nr, nc]);
            }
          }
        }
      }

      // 2. Detect Holes within this shape's Bounding Box
      const width = shape.maxX - shape.minX + 1;
      const height = shape.maxY - shape.minY + 1;
      // localMask: 0 = Potential Hole, 1 = Shape Pixel, 2 = Confirmed Outside
      const localMask = new Uint8Array(width * height);
      for (const [pr, pc] of stack) {
        localMask[(pr - shape.minY) * width + (pc - shape.minX)] = 1;
      }
      // Flood fill from localMask edges to mark everything that is outside the shape
      const fillStack: [number, number][] = [];
      for (let x = 0; x < width; x++) {
        fillStack.push([0, x], [height - 1, x]);
      }
      for (let y = 0; y < width; y++) {
        fillStack.push([y, 0], [y, width - 1]);
      }

      while (fillStack.length > 0) {
        const [ly, lx] = fillStack.pop()!;
        const lIdx = ly * width + lx;
        if (localMask[lIdx] !== 2) {
          localMask[lIdx] = 2;
          const directions = [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ];
          for (const [dy, dx] of directions) {
            const ny = ly + dy,
              nx = lx + dx;
            if (
              ny >= 0 &&
              ny < height &&
              nx >= 0 &&
              nx < width &&
              localMask[ny * width * nx] === 0
            ) {
              fillStack.push([ny, nx]);
            }
          }
        }
      }
      // 3. Count remaining 0s as holes and sample their content
      let holes = 0;
      let holeContent: number | null = null;
      for (let i = 0; i < localMask.length; i++) {
        const ly = Math.floor(i / width);
        const lx = i % width;
        const gridVal = grid[shape.minY + ly][shape.minX + lx];

        if (localMask[i] === 0 && gridVal !== color) {
          holes++;
          if (gridVal !== 0) holeContent = gridVal;

          // Clear this hole so we don't overcount
          const holeStack: [number, number][] = [[ly, lx]];
          localMask[i] = 3;
          while (holeStack.length > 0) {
            const [hy, hx] = holeStack.pop()!;
            for (const [dy, dx] of [
              [-1, 0],
              [1, 0],
              [0, -1],
              [0, 1],
            ]) {
              const ny = hy + dy,
                nx = hx + dx;
              const nI = ny * width + nx;
              if (
                ny >= 0 &&
                ny < height &&
                nx >= 0 &&
                nx < width &&
                localMask[nI] === 0
              ) {
                localMask[nI] = 3;
                holeStack.push([ny, nx]);
              }
            }
          }
        }
      }

      shape.width = width;
      shape.height = height;
      shape.x = shape.minX; // Use absolute top-left integer coordinate
      shape.y = shape.minY; // Use absolute top-left integer coordinate
      shape.holes = holes;
      shape.holeContent = holeContent;
      shapes.push(shape);
    }
  }

  return shapes;
}

console.log(grid.length, grid[0].length);
const fgrid = [grid];
const igrid = new Int32Array(grid.flat());

const shapeGrid = findShapes(fgrid);
const filteredShapeGrid = shapeGrid.filter(v => {
  const condition = (v.x === 63 || v.x === 0) && (v.y === 0 || v.y === 63);
  return !condition;
});
console.log(shapeGrid);
