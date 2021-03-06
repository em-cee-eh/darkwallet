/**
 * @fileOverview HistoryProvider angular provider
 */
'use strict';

define(['./module', 'util/btc', 'darkwallet', 'dwutil/multisig'],
function (providers, BtcUtils, DarkWallet, MultisigFund) {

  var monthNames = [ "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December" ];

  // Get date 30 days ago
  var prevmonth = new Date();
  prevmonth.setDate(prevmonth.getDate()-30);

  // Get date 7 days ago
  var prevweek = new Date();
  prevweek.setDate(prevweek.getDate()-7);


  /**
   * History provider class
   */ 
  function HistoryProvider($scope, $wallet) {
      this.pocket = {index: undefined, name: 'All Pockets', mpk: undefined, addresses: $wallet.allAddresses, changeAddresses: [], isAll: true};
      this.txFilter = 'last10';
      this.addrFilter = 'unused';
      this.$wallet = $wallet;
      this.rows = [];
  }

  /**
   * Balance
   */ 
  HistoryProvider.prototype.calculateBalance = function(pocket) {
      var balance;
      var wallet = DarkWallet.getIdentity().wallet;
      if (pocket.isFund) {
          balance = wallet.getBalance(pocket.fund.multisig.seq[0]);
      } else if (pocket.isAll) {
          balance = wallet.getBalance();
      } else {
          var mainBalance = wallet.getBalance(pocket.index*2);
          var changeBalance = wallet.getBalance((pocket.index*2)+1);

          var confirmed = mainBalance.confirmed + changeBalance.confirmed;
          var unconfirmed = mainBalance.unconfirmed + changeBalance.unconfirmed;
          var current = mainBalance.current + changeBalance.current;
          balance = {confirmed: confirmed, unconfirmed: unconfirmed, current: current};
      }
      return balance;
  }

  /**
   * Pocket change
   */ 
  HistoryProvider.prototype.isCurrentPocket = function(pocketId) {
      if (this.pocket.isAll) {
          return true;
      } else if (this.pocket.index == pocketId) {
          return true;
      }
  }

  HistoryProvider.prototype.onBalanceUpdate = function() {
      this.pocket.balance = this.calculateBalance(this.pocket);
      return this.chooseRows();
  }

  HistoryProvider.prototype.getCurrentPocket = function() {
      return this.pocket;
  }

  // History Listing
  HistoryProvider.prototype.selectFund = function(fund, rowIndex) {
      var identity = DarkWallet.getIdentity();
      this.pocket.name = fund.name;
      this.pocket.index = fund.seq[0];
      var address = identity.wallet.getAddress(fund.seq);

      this.pocket.changeAddresses = [];
      this.pocket.addresses = [address];
      this.pocket.mainAddress = address.address;
      this.pocket.fund = new MultisigFund(fund);
      this.pocket.tasks = this.pocket.fund.tasks;

      this.pocket.isAll = false;
      this.pocket.isFund = true;
      this.pocket.mpk = undefined;
      this.pocket.stealth = undefined;
      this.selectedPocket = 'fund:' + rowIndex;

      this.pocket.balance = identity.wallet.getBalance(fund.seq[0]);

      return this.chooseRows();
  };

  HistoryProvider.prototype.selectOverview = function() {
      this.selectPocket('overview');
  };

  HistoryProvider.prototype.selectAll = function(pocketName, rowIndex) {
      var identity = DarkWallet.getIdentity();
      var pocketIndex;
      this.pocket.name = pocketName ? "Overview" : "All Pockets";
      this.pocket.index = undefined;
      this.pocket.mpk = undefined;

      var mainAddress = identity.wallet.getAddress([0]);
      this.pocket.stealth = mainAddress.stealth;
      this.pocket.mainAddress = mainAddress.stealth;

      this.pocket.fund = null;
      this.pocket.addresses = this.$wallet.allAddresses;
      this.pocket.changeAddresses = [];
      this.pocket.isAll = true;
      this.pocket.isOverview = (pocketName == 'overview');
      this.pocket.isFund = false;

      this.pocket.balance = identity.wallet.getBalance();

      this.pocket.tasks = [];
      rowIndex = pocketName ? pocketName : 'all';
      this.selectedPocket = 'pocket:' + rowIndex;
      return this.chooseRows();
  };

  HistoryProvider.prototype.selectPocket = function(pocketName, rowIndex) {
      var identity = DarkWallet.getIdentity();
      if (pocketName === undefined || pocketName == 'overview') {
          return this.selectAll(pocketName, rowIndex);
      }
      var pocketIndex = rowIndex*2;

      this.pocket.index = rowIndex;
      this.pocket.name = pocketName;
      this.pocket.fund = null;
      var walletAddress = identity.wallet.getAddress([pocketIndex]);
      this.pocket.mpk = walletAddress.mpk;
      this.pocket.stealth = walletAddress.stealth;
      this.pocket.mainAddress = walletAddress.stealth;
      this.pocket.addresses = this.$wallet.addresses[pocketIndex];
      this.pocket.changeAddresses = this.$wallet.addresses[pocketIndex+1];

      var walletPocket = identity.wallet.pockets.getPocket(pocketName);

      this.pocket.mixing = walletPocket.mixing;
      this.pocket.tasks = [];
      this.pocket.isAll = false;
      this.pocket.isFund = false;

      this.pocket.balance = this.calculateBalance(this.pocket);

      this.selectedPocket = 'pocket:' + rowIndex;
      return this.chooseRows();
  };


  // Filters
  HistoryProvider.prototype.fillRowContact = function(contacts, row) {
      if (!row.contact) {
          var contact = contacts.findByAddress(row.address);
          if (contact) {
              row.contact = contact;
          }
      }
  }
 
  // Filter the rows we want to show
  HistoryProvider.prototype.chooseRows = function() {
      var identity =  DarkWallet.getIdentity();
      var self = this;
      var history = identity.history.history;
      var rows = history.filter(this.pocketFilter, this);
      rows = rows.sort(function(a, b) {
         if (!a.height) {
            return -10000000;
         }
         if (!b.height) {
            return 10000000;
         }
         return b.height - a.height;
      });
      var shownRows = [];
      rows = rows.filter(function(row) { return self.historyFilter(row, shownRows) } );
      if (!rows.length) {
          return [];
      }
      if (this.txFilter == 'weekly') {
          this.rows = this.calculateWeekly(rows);
      }
      else if (this.txFilter == 'monthly') {
          this.rows = this.calculateMonthly(rows);
      } else {
          this.rows = this.calculateHistory(rows);
      }
      return this.rows;
  }

  HistoryProvider.prototype.calculateMonthly = function(rows) {
      var self = this;
      var pocketId = this.pocket.index;
      var now = new Date();
      var d = now.getDate(); //get the current day
      var monthStart = new Date(now.valueOf() - ((d==1?0:d-1)*86400000)); //rewind to start day
      var monthEnd;
      var getLabel = function(dateStart, dateEnd) {
         return monthNames[dateEnd.getMonth()]+"/"+dateEnd.getFullYear();
      }
      var month = {index: 0, incoming: 0, outgoing: 0, transactions: 0, label: getLabel(monthStart, monthStart)};
      var result = [month];

      var monthIndex = 0;
      var blockDiff = DarkWallet.service.wallet.blockDiff;
      rows.forEach(function(row) {
           if (row.height) {
               var timestamp = BtcUtils.heightToTimestamp(row.height, blockDiff);
               while (timestamp < monthStart) {
                   monthEnd = new Date(monthStart.valueOf()-86400000);
                   monthStart = new Date(monthStart.valueOf()-(monthEnd.getDate()*86400000));
                   monthIndex -= 1;
                   var label = getLabel(monthStart, monthEnd);
                   month = {index: monthIndex, incoming: 0, outgoing: 0, transactions: 0, label: label};
                   result.push(month);
               }
           }
           month.transactions += 1;
           var impact = self.getRowImpact(row);
           if (impact>0) {
               month.incoming += impact;
           } else {
               month.outgoing -= impact;
           }
      });

      return result;
  }

  HistoryProvider.prototype.calculateWeekly = function(rows) {
      var self = this;
      var pocketId = this.pocket.index;
      var now = new Date();
      var startDay = 1; //0=sunday, 1=monday etc.
      var d = now.getDay(); //get the current day
      var weekStart = new Date(now.valueOf() - (d<=0 ? 7-startDay:d-startDay)*86400000); //rewind to start day
      var weekEnd = new Date(weekStart.valueOf() + 6*86400000); //add 6 days to get last day

      var getLabel = function(dateStart, dateEnd) {
         var start = dateStart.toLocaleDateString();
         var end = weekEnd.toLocaleDateString()
         //return monthNames[weekStart.getMonth()]+"-"+(Math.floor(weekStart.getDate()/7)+1);
         return start + "-" + end;
      }
      var week = {index: 0, incoming: 0, outgoing: 0, transactions: 0};
      var result = [week];

      var weekIndex = 0;
      var blockDiff = DarkWallet.service.wallet.blockDiff;

      rows.forEach(function(row) {
           if (row.height) {
               var timestamp = BtcUtils.heightToTimestamp(row.height, blockDiff);
               while (timestamp < weekStart) {
                   weekEnd = new Date(weekStart.valueOf()-86400000);
                   weekStart = new Date(weekStart.valueOf()-(7*86400000));
                   weekIndex -= 1;
                   var label = getLabel(weekStart, weekEnd);
                   week = {index: weekIndex, incoming: 0, outgoing: 0, transactions: 0, label: label};
                   result.push(week);
               }
           }
           week.transactions += 1;
           var impact = self.getRowImpact(row);
           if (impact>0) {
               week.incoming += impact;
           } else {
               week.outgoing -= impact;
           }
      });

      return result;
  }

  HistoryProvider.prototype.getRowImpact = function(row) {
      if (this.pocket.index === undefined) {
          return row.total;
      } else {
          return row.impact[this.pocket.index].total;
      }
  }

  HistoryProvider.prototype.calculateHistory = function(rows) {
      var identity =  DarkWallet.getIdentity();
      var pocketId = this.pocket.index;

      // Now calculate balances
      var prevRow = rows[0];
      prevRow.confirmed = this.pocket.balance.confirmed;
      prevRow.unconfirmed = this.pocket.balance.unconfirmed;
      prevRow.current = this.pocket.balance.current;
      prevRow.partial = this.getRowImpact(prevRow);

      var contacts = identity.contacts;
      this.fillRowContact(contacts, prevRow);
      var idx = 1;
      while(idx<rows.length) {
          var row = rows[idx];
          this.fillRowContact(contacts, row);
          
          var value = prevRow.partial;

          row.partial = this.getRowImpact(row);

          row.current = prevRow.current-value;

          if (prevRow.height || prevRow.inMine) {
              row.confirmed = prevRow.confirmed-value;
              row.unconfirmed = prevRow.unconfirmed;
              if (!prevRow.height) {
                 // outgoing
                 row.unconfirmed -= value;
              }
          } else {
              row.confirmed = prevRow.confirmed;
              row.unconfirmed = prevRow.unconfirmed-value;
          }
          prevRow = row;
          idx++;
      }
      return rows;
  }


  HistoryProvider.prototype.pocketFilter = function(row) {
      // Making sure shownRows is reset before historyFilter stage is reached.
      if (this.pocket.isAll) {
          // only add pocket transactions for now
          return ((typeof row.inPocket === 'number') || (typeof row.outPocket === 'number'));
      }
      else {
          return (row.inPocket == this.pocket.index || row.outPocket == this.pocket.index);
      }
  };

  // Set the history filter
  HistoryProvider.prototype.setAddressFilter = function(name) {
      this.addrFilter = name;
      return name;
  };

  HistoryProvider.prototype.addressFilter = function(row) {
      switch(this.addrFilter) {
          case 'all':
              return true;
          case 'unused':
              return !row.nOutputs;
          case 'top':
              return row.balance>0;
          case 'labelled':
              return ['unused', 'change'].indexOf(row.label) == -1;
          default:
              break;
      }

  };

  // Set the history filter
  HistoryProvider.prototype.setHistoryFilter = function(name) {
      this.txFilter = name;
      return this.chooseRows();
  };

  HistoryProvider.prototype.historyFilter = function(row, shownRows) {
      var blockDiff = DarkWallet.service.wallet.blockDiff;
      if (!row.height) {
          shownRows.push(row.hash);
          return true;
      }
      switch(this.txFilter) {
          case 'all':
          case 'weekly':
          case 'monthly':
              return true;
          case 'lastWeek':
              var ts = BtcUtils.heightToTimestamp(row.height, blockDiff);
              if (ts > prevweek.getTime()) {
                  return true;
              }
              break;
          case 'lastMonth':
              var ts = BtcUtils.heightToTimestamp(row.height, blockDiff);
              if (ts > prevmonth.getTime()) {
                  return true;
              }
              break;
          case 'last10':
          default:
              if (shownRows.indexOf(row.hash) != -1) {
                  return true;
              } else if (shownRows.length < 10) {
                  shownRows.push(row.hash);
                  return true;
              }
      }
      return false;
  };

  providers.factory('$history', ['$rootScope', '$wallet', function($rootScope, $wallet) {
      console.log("[WalletProvider] Initialize");
      return new HistoryProvider($rootScope.$new(), $wallet);
  }]);


});
