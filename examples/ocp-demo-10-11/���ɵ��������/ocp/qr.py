"""Minimal QR Code version 8-L generator used for sandbox payment intents."""


VERSION = 8
SIZE = 17 + 4 * VERSION
DATA_CODEWORDS = 194
ECC_CODEWORDS = 24
BLOCK_DATA_CODEWORDS = 97
BLOCK_COUNT = 2


class QRCodeError(ValueError):
    pass


class _BitBuffer:
    def __init__(self):
        self.bits = []

    def put(self, value, length):
        for shift in range(length - 1, -1, -1):
            self.bits.append((value >> shift) & 1)

    @property
    def length(self):
        return len(self.bits)

    def to_bytes(self):
        output = bytearray()
        for start in range(0, len(self.bits), 8):
            chunk = self.bits[start : start + 8]
            chunk.extend([0] * (8 - len(chunk)))
            value = 0
            for bit in chunk:
                value = (value << 1) | bit
            output.append(value)
        return list(output)


def make_qr_svg(data, module_size=8, border=4):
    raw = data.encode("utf-8")
    matrix = _make_matrix(raw)
    total = SIZE + border * 2
    dark_path = []
    for row, cells in enumerate(matrix):
        for col, value in enumerate(cells):
            if value:
                dark_path.append(
                    "M%d %dh1v1h-1z" % (col + border, row + border)
                )
    view_size = total * module_size
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        'width="%d" height="%d" viewBox="0 0 %d %d" '
        'shape-rendering="crispEdges">'
        '<rect width="100%%" height="100%%" fill="#fff"/>'
        '<path d="%s" fill="#101828"/>'
        "</svg>"
    ) % (
        view_size,
        view_size,
        total,
        total,
        "".join(dark_path),
    )


def _make_matrix(data):
    codewords = _encode_data(data)
    blocks = [
        codewords[index * BLOCK_DATA_CODEWORDS : (index + 1) * BLOCK_DATA_CODEWORDS]
        for index in range(BLOCK_COUNT)
    ]
    ecc_blocks = [_reed_solomon(block, ECC_CODEWORDS) for block in blocks]
    interleaved = []
    for index in range(BLOCK_DATA_CODEWORDS):
        for block in blocks:
            interleaved.append(block[index])
    for index in range(ECC_CODEWORDS):
        for block in ecc_blocks:
            interleaved.append(block[index])

    matrix = [[None for _ in range(SIZE)] for _ in range(SIZE)]
    _place_finder(matrix, 0, 0)
    _place_finder(matrix, SIZE - 7, 0)
    _place_finder(matrix, 0, SIZE - 7)
    _place_timing(matrix)
    _place_alignment(matrix)
    _reserve_format(matrix)
    _place_version_info(matrix)
    _place_data(matrix, interleaved)
    _place_format_info(matrix)
    return [[1 if value else 0 for value in row] for row in matrix]


def _encode_data(data):
    bits = _BitBuffer()
    bits.put(0b0100, 4)
    bits.put(len(data), 8)
    for byte in data:
        bits.put(byte, 8)

    capacity_bits = DATA_CODEWORDS * 8
    if bits.length > capacity_bits:
        raise QRCodeError(
            "Payload is too large for QR version 8-L: %s bytes" % len(data)
        )
    bits.put(0, min(4, capacity_bits - bits.length))
    while bits.length % 8:
        bits.put(0, 1)
    codewords = bits.to_bytes()
    pads = [0xEC, 0x11]
    pad_index = 0
    while len(codewords) < DATA_CODEWORDS:
        codewords.append(pads[pad_index % 2])
        pad_index += 1
    return codewords


def _gf_multiply(left, right):
    result = 0
    while right:
        if right & 1:
            result ^= left
        right >>= 1
        left <<= 1
        if left & 0x100:
            left ^= 0x11D
    return result & 0xFF


def _generator_polynomial(degree):
    polynomial = [1]
    factor = 1
    for _ in range(degree):
        next_polynomial = [0] * (len(polynomial) + 1)
        for index, coefficient in enumerate(polynomial):
            next_polynomial[index] ^= coefficient
            next_polynomial[index + 1] ^= _gf_multiply(coefficient, factor)
        polynomial = next_polynomial
        factor = _gf_multiply(factor, 2)
    return polynomial


def _reed_solomon(data, degree):
    generator = _generator_polynomial(degree)
    remainder = [0] * degree
    for value in data:
        factor = value ^ remainder[0]
        remainder = remainder[1:] + [0]
        if factor:
            for index, coefficient in enumerate(generator[1:]):
                remainder[index] ^= _gf_multiply(coefficient, factor)
    return remainder


def _place_finder(matrix, row, col):
    for y in range(-1, 8):
        for x in range(-1, 8):
            target_row = row + y
            target_col = col + x
            if not (0 <= target_row < SIZE and 0 <= target_col < SIZE):
                continue
            dark = (
                0 <= x <= 6
                and 0 <= y <= 6
                and (
                    x in (0, 6)
                    or y in (0, 6)
                    or (2 <= x <= 4 and 2 <= y <= 4)
                )
            )
            matrix[target_row][target_col] = 1 if dark else 0


def _place_timing(matrix):
    for index in range(8, SIZE - 8):
        value = 1 if index % 2 == 0 else 0
        matrix[6][index] = value
        matrix[index][6] = value


def _place_alignment(matrix):
    centers = (6, 24, 42)
    for row in centers:
        for col in centers:
            if (
                (row == 6 and col == 6)
                or (row == 6 and col == SIZE - 7)
                or (row == SIZE - 7 and col == 6)
            ):
                continue
            for y in range(-2, 3):
                for x in range(-2, 3):
                    matrix[row + y][col + x] = (
                        1 if max(abs(x), abs(y)) != 1 else 0
                    )


def _reserve_format(matrix):
    for index in range(9):
        if matrix[index][8] is None:
            matrix[index][8] = 0
        if matrix[8][index] is None:
            matrix[8][index] = 0
    for index in range(SIZE - 8, SIZE):
        if matrix[8][index] is None:
            matrix[8][index] = 0
        if matrix[index][8] is None:
            matrix[index][8] = 0


def _place_version_info(matrix):
    value = _bch_version(VERSION)
    for index in range(18):
        bit = (value >> index) & 1
        matrix[SIZE - 11 + index % 3][index // 3] = bit
        matrix[index // 3][SIZE - 11 + index % 3] = bit


def _place_data(matrix, codewords):
    bits = []
    for value in codewords:
        for shift in range(7, -1, -1):
            bits.append((value >> shift) & 1)
    bit_index = 0
    direction = -1
    row = SIZE - 1
    col = SIZE - 1
    while col > 0:
        if col == 6:
            col -= 1
        while 0 <= row < SIZE:
            for target_col in (col, col - 1):
                if matrix[row][target_col] is None:
                    value = bits[bit_index] if bit_index < len(bits) else 0
                    if (row + target_col) % 2 == 0:
                        value ^= 1
                    matrix[row][target_col] = value
                    bit_index += 1
            row += direction
        row -= direction
        direction *= -1
        col -= 2


def _place_format_info(matrix):
    value = _bch_format((0b01 << 3) | 0)
    for index in range(15):
        bit = (value >> index) & 1
        if index < 6:
            matrix[index][8] = bit
        elif index < 8:
            matrix[index + 1][8] = bit
        else:
            matrix[SIZE - 15 + index][8] = bit

        if index < 8:
            matrix[8][SIZE - index - 1] = bit
        elif index < 9:
            matrix[8][15 - index] = bit
        else:
            matrix[8][14 - index] = bit
    matrix[SIZE - 8][8] = 1


def _bch_format(data):
    value = data << 10
    polynomial = 0x537
    while value.bit_length() >= polynomial.bit_length():
        value ^= polynomial << (value.bit_length() - polynomial.bit_length())
    return ((data << 10) | value) ^ 0x5412


def _bch_version(version):
    value = version << 12
    polynomial = 0x1F25
    while value.bit_length() >= polynomial.bit_length():
        value ^= polynomial << (value.bit_length() - polynomial.bit_length())
    return (version << 12) | value
