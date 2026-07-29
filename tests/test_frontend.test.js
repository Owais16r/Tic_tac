function checkHorizontalWin(board, size, winLen, symbol) {
    for (let r = 0; r < size; r++) {
        for (let c = 0; c <= size - winLen; c++) {
            let cnt = 0;
            for (let i = 0; i < winLen; i++) {
                if (board[r * size + (c + i)] === symbol) cnt++;
            }
            if (cnt === winLen) return true;
        }
    }
    return false;
}

test('Detects horizontal win on 3x3 board', () => {
    const board = ['X', 'X', 'X', ' ', ' ', ' ', ' ', ' ', ' '];
    expect(checkHorizontalWin(board, 3, 3, 'X')).toBe(true);
});

test('Returns false when horizontal win condition not met', () => {
    const board = ['X', 'O', 'X', ' ', ' ', ' ', ' ', ' ', ' '];
    expect(checkHorizontalWin(board, 3, 3, 'X')).toBe(false);
});