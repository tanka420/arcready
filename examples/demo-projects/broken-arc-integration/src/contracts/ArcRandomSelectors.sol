pragma solidity ^0.8.24;

contract RelaySelector {
  address[] internal relayers;

  function selectRelay() external view returns (address) {
    return relayers[block.prevrandao % relayers.length];
  }
}

contract WinnerSelector {
  address[] internal winners;

  function chooseWinner() external view returns (address) {
    return winners[block.prevrandao % winners.length];
  }
}
