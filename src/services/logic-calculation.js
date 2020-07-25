import _ from 'lodash';

import DUNGEONS from '../data/dungeons.json';
import KEYS from '../data/keys.json';

import Locations from './locations';
import LogicHelper from './logic-helper';
import Memoizer from './memoizer';
import Permalink from './permalink';
import Settings from './settings';

export default class LogicCalculation {
  constructor(state) {
    this.state = state;

    Memoizer.memoize(this, [
      this.estimatedLocationsLeftToCheck,
      this.formattedRequirementsForEntrance,
      this.formattedRequirementsForLocation,
      this.isEntranceAvailable,
      this.isLocationAvailable,
      this.itemsNeededToFinishGame,
      this.locationCounts,
      this.totalLocationsAvailable,
      this.totalLocationsChecked,
      this.totalLocationsRemaining,
      this._itemsRemainingForLocation,
      this._itemsRemainingForRequirement,
    ]);

    this._setGuaranteedKeys();
  }

  static ITEM_REQUIREMENT_COLORS = {
    AVAILABLE_ITEM: 'available-item',
    INCONSEQUENTIAL_ITEM: 'inconsequential-item',
    PLAIN_TEXT: 'plain-text',
    UNAVAILABLE_ITEM: 'unavailable-item',
  };

  static LOCATION_COLORS = {
    AVAILABLE_LOCATION: 'available-location',
    CHECKED_LOCATION: 'checked-location',
    NON_PROGRESS_LOCATION: 'non-progress-location',
    UNAVAILABLE_LOCATION: 'unavailable-location',
  };

  isLocationAvailable(generalLocation, detailedLocation) {
    if (this.state.isLocationChecked(generalLocation, detailedLocation)) {
      return true;
    }

    const requirementsForLocation = LogicHelper.requirementsForLocation(
      generalLocation,
      detailedLocation,
    );

    return this._areRequirementsMet(requirementsForLocation);
  }

  isEntranceAvailable(dungeonOrCaveName) {
    const requirementsForEntrance = LogicHelper.requirementsForEntrance(dungeonOrCaveName);

    return this._areRequirementsMet(requirementsForEntrance);
  }

  formattedRequirementsForLocation(generalLocation, detailedLocation) {
    const requirementsForLocation = LogicHelper.requirementsForLocation(
      generalLocation,
      detailedLocation,
    );

    return this._formatRequirements(requirementsForLocation);
  }

  formattedRequirementsForEntrance(dungeonOrCaveName) {
    const requirementsForEntrance = LogicHelper.requirementsForEntrance(dungeonOrCaveName);

    return this._formatRequirements(requirementsForEntrance);
  }

  locationCounts(generalLocation, { isDungeon, onlyProgressLocations, disableLogic }) {
    const detailedLocations = LogicHelper.filterDetailedLocations(
      generalLocation,
      { isDungeon, onlyProgressLocations },
    );

    let anyProgress = false;
    let numAvailable = 0;
    let numRemaining = 0;

    _.forEach(detailedLocations, (detailedLocation) => {
      if (!this.state.isLocationChecked(generalLocation, detailedLocation)) {
        if (disableLogic || this.isLocationAvailable(generalLocation, detailedLocation)) {
          numAvailable += 1;

          if (LogicHelper.isProgressLocation(generalLocation, detailedLocation)) {
            anyProgress = true;
          }
        }
        numRemaining += 1;
      }
    });

    const color = LogicCalculation._locationCountsColor(numAvailable, numRemaining, anyProgress);

    return {
      color,
      numAvailable,
      numRemaining,
    };
  }

  totalLocationsChecked({ onlyProgressLocations }) {
    return LogicCalculation._countLocationsBy(
      (generalLocation, detailedLocation) => {
        const isLocationChecked = this.state.isLocationChecked(generalLocation, detailedLocation);

        return isLocationChecked ? 1 : 0;
      },
      { onlyProgressLocations },
    );
  }

  totalLocationsAvailable({ onlyProgressLocations }) {
    return LogicCalculation._countLocationsBy(
      (generalLocation, detailedLocation) => {
        if (this.state.isLocationChecked(generalLocation, detailedLocation)) {
          return 0;
        }

        const isLocationAvailable = this.isLocationAvailable(
          generalLocation,
          detailedLocation,
        );

        return isLocationAvailable ? 1 : 0;
      },
      { onlyProgressLocations },
    );
  }

  totalLocationsRemaining({ onlyProgressLocations }) {
    return LogicCalculation._countLocationsBy(
      (generalLocation, detailedLocation) => {
        const isLocationChecked = this.state.isLocationChecked(generalLocation, detailedLocation);

        return isLocationChecked ? 0 : 1;
      },
      { onlyProgressLocations },
    );
  }

  itemsNeededToFinishGame() {
    return this._itemsRemainingForLocation(
      LogicHelper.DUNGEONS.GANONS_TOWER,
      LogicHelper.DEFEAT_GANONDORF_LOCATION,
    );
  }

  estimatedLocationsLeftToCheck() {
    const locationsRemaining = this.totalLocationsRemaining({ onlyProgressLocations: true });

    // there can't be more items remaining than locations remaining unless the tracker is used
    // incorrectly, so we apply a maximum to make sure our formula always works
    const itemsRemaining = Math.min(
      this.itemsNeededToFinishGame(),
      locationsRemaining,
    );

    // expected value for draws without replacement
    return _.round(
      (itemsRemaining * (locationsRemaining + 1)) / (itemsRemaining + 1),
    );
  }

  _areRequirementsMet(requirements) {
    return requirements.evaluate({
      isItemTrue: (requirement) => this._isRequirementMet(requirement),
    });
  }

  _itemsRemainingForRequirements(requirements) {
    return requirements.reduce({
      andInitialValue: 0,
      andReducer: ({
        accumulator,
        item,
        isReduced,
      }) => accumulator + (isReduced ? item : this._itemsRemainingForRequirement(item)),
      orInitialValue: 0,
      orReducer: ({
        accumulator,
        item,
        isReduced,
      }) => Math.max(accumulator, (isReduced ? item : this._itemsRemainingForRequirement(item))),
    });
  }

  _itemsRemainingForLocation(generalLocation, detailedLocation) {
    if (this.state.isLocationChecked(generalLocation, detailedLocation)) {
      return 0;
    }

    const requirementsForLocation = LogicHelper.requirementsForLocation(
      generalLocation,
      detailedLocation,
    );

    return this._itemsRemainingForRequirements(requirementsForLocation);
  }

  _setGuaranteedKeys() {
    this.guaranteedKeys = _.reduce(
      _.keys(KEYS),
      (accumulator, keyName) => _.set(accumulator, keyName, this.state.getItemValue(keyName)),
      {},
    );

    if (!Settings.getOptionValue(Permalink.OPTIONS.KEY_LUNACY)) {
      _.forEach(DUNGEONS, (dungeonName) => {
        if (LogicHelper.isMainDungeon(dungeonName)) {
          const {
            guaranteedSmallKeys,
            guaranteedBigKeys,
          } = this._guaranteedKeysForDungeon(dungeonName);

          const smallKeyName = LogicHelper.smallKeyName(dungeonName);
          const bigKeyName = LogicHelper.bigKeyName(dungeonName);

          const currentSmallKeyCount = _.get(this.guaranteedKeys, smallKeyName);
          const currentBigKeyCount = _.get(this.guaranteedKeys, bigKeyName);

          if (guaranteedSmallKeys > currentSmallKeyCount) {
            _.set(this.guaranteedKeys, smallKeyName, guaranteedSmallKeys);
          }
          if (guaranteedBigKeys > currentBigKeyCount) {
            _.set(this.guaranteedKeys, bigKeyName, guaranteedBigKeys);
          }
        }
      });
    }

    Memoizer.invalidate([
      this.isLocationAvailable,
      this._itemsRemainingForRequirement,
    ]);
  }

  _guaranteedKeysForDungeon(dungeonName) {
    const detailedLocations = Locations.detailedLocationsForGeneralLocation(dungeonName);

    let guaranteedSmallKeys = LogicHelper.maxSmallKeysForDungeon(dungeonName);
    let guaranteedBigKeys = 1;

    _.forEach(detailedLocations, (detailedLocation) => {
      if (LogicHelper.isPotentialKeyLocation(dungeonName, detailedLocation)
      && !this._nonKeyRequirementsMetForLocation(dungeonName, detailedLocation)) {
        const smallKeysRequired = LogicHelper.smallKeysRequiredForLocation(
          dungeonName,
          detailedLocation,
        );

        if (smallKeysRequired < guaranteedSmallKeys) {
          guaranteedSmallKeys = smallKeysRequired;
        }
        guaranteedBigKeys = 0;
      }
    });

    return {
      guaranteedSmallKeys,
      guaranteedBigKeys,
    };
  }

  _nonKeyRequirementsMetForLocation(generalLocation, detailedLocation) {
    if (this.isLocationAvailable(generalLocation, detailedLocation)) {
      return true;
    }

    const requirementsForLocation = LogicHelper.requirementsForLocation(
      generalLocation,
      detailedLocation,
    );

    const smallKeyName = LogicHelper.smallKeyName(generalLocation);

    return requirementsForLocation.evaluate({
      isItemTrue: (requirement) => {
        if (_.includes(requirement, smallKeyName)) {
          return true; // assume we have all small keys
        }

        return this._isRequirementMet(requirement);
      },
    });
  }

  _isRequirementMet(requirement) {
    const itemsRemaining = this._itemsRemainingForRequirement(requirement);
    return itemsRemaining === 0;
  }

  _itemsRemainingForRequirement(requirement) {
    const remainingItemsForRequirements = [
      LogicCalculation._impossibleRequirementRemaining(requirement),
      LogicCalculation._nothingRequirementRemaining(requirement),
      this._itemCountRequirementRemaining(requirement),
      this._itemRequirementRemaining(requirement),
      this._hasAccessedOtherLocationRequirementRemaining(requirement),
    ];

    const remainingItems = _.find(remainingItemsForRequirements, (result) => !_.isNil(result));

    if (!_.isNil(remainingItems)) {
      return remainingItems;
    }
    throw Error(`Could not parse requirement: ${requirement}`);
  }

  static _impossibleRequirementRemaining(requirement) {
    if (requirement === LogicHelper.TOKENS.IMPOSSIBLE) {
      return 1;
    }

    return null;
  }

  static _nothingRequirementRemaining(requirement) {
    if (requirement === LogicHelper.TOKENS.NOTHING) {
      return 0;
    }

    return null;
  }

  _itemCountRequirementRemaining(requirement) {
    const itemCountRequirement = LogicHelper.parseItemCountRequirement(requirement);
    if (!_.isNil(itemCountRequirement)) {
      const {
        countRequired,
        itemName,
      } = itemCountRequirement;

      const itemCount = this._currentItemValue(itemName);
      return Math.max(countRequired - itemCount, 0);
    }

    return null;
  }

  _itemRequirementRemaining(requirement) {
    const itemValue = this._currentItemValue(requirement);
    if (!_.isNil(itemValue)) {
      if (itemValue > 0) {
        return 0;
      }
      return 1;
    }

    return null;
  }

  _hasAccessedOtherLocationRequirementRemaining(requirement) {
    const otherLocationMatch = requirement.match(/Has Accessed Other Location "([^"]+)"/);
    if (otherLocationMatch) {
      const {
        generalLocation,
        detailedLocation,
      } = Locations.splitLocationName(otherLocationMatch[1]);

      return this._itemsRemainingForLocation(generalLocation, detailedLocation);
    }

    return null;
  }

  static _BOOLEAN_EXPRESSION_TYPES = {
    AND: 'and',
    OR: 'or',
  };

  _formatRequirements(requirements) {
    const evaluatedRequirements = this._evaluatedRequirements(requirements);
    const sortedRequirements = LogicCalculation._sortRequirements(evaluatedRequirements);
    const readableRequirements = LogicCalculation._createReadableRequirements(sortedRequirements);
    return readableRequirements;
  }

  _evaluatedRequirements(requirements) {
    const generateReducerFunction = (getAccumulatorValue) => ({
      accumulator,
      item,
      isReduced,
    }) => {
      if (isReduced) {
        const sortedExpression = LogicCalculation._sortRequirements(item);

        return {
          items: _.concat(accumulator.items, sortedExpression),
          type: accumulator.type,
          value: getAccumulatorValue(accumulator.value, sortedExpression.value),
        };
      }

      const wrappedItem = {
        item,
        value: this._isRequirementMet(item),
      };

      return {
        items: _.concat(accumulator.items, wrappedItem),
        type: accumulator.type,
        value: getAccumulatorValue(accumulator.value, wrappedItem.value),
      };
    };

    return requirements.reduce({
      andInitialValue: {
        items: [],
        type: LogicCalculation._BOOLEAN_EXPRESSION_TYPES.AND,
        value: true,
      },
      andReducer: (reducerArgs) => generateReducerFunction(
        (accumulatorValue, itemValue) => accumulatorValue && itemValue,
      )(reducerArgs),
      orInitialValue: {
        items: [],
        type: LogicCalculation._BOOLEAN_EXPRESSION_TYPES.OR,
        value: false,
      },
      orReducer: (reducerArgs) => generateReducerFunction(
        (accumulatorValue, itemValue) => accumulatorValue || itemValue,
      )(reducerArgs),
    });
  }

  static _sortRequirements(requirements) {
    const sortedItems = _.sortBy(requirements.items, (item) => {
      if (requirements.value) {
        return item.value ? 0 : 1; // if the expression is true, we put items we have first
      }
      return item.value ? 1 : 0; // if the expression is false, we put items we're missing first
    });

    return {
      items: sortedItems,
      type: requirements.type,
      value: requirements.value,
    };
  }

  static _createReadableRequirements(requirements) {
    if (requirements.type === this._BOOLEAN_EXPRESSION_TYPES.AND) {
      return _.map(
        requirements.items,
        (item) => _.flattenDeep(this._createReadableRequirementsHelper(item, requirements.value)),
      );
    }
    if (requirements.type === this._BOOLEAN_EXPRESSION_TYPES.OR) {
      return [
        _.flattenDeep(this._createReadableRequirementsHelper(requirements, false)),
      ];
    }
    throw Error(`Invalid requirements: ${JSON.stringify(requirements)}`);
  }

  static _createReadableRequirementsHelper(requirements, isInconsequential) {
    if (requirements.item) {
      const itemName = LogicHelper.prettyNameForItemRequirement(requirements.item);

      let itemColor;
      if (requirements.value) {
        itemColor = this.ITEM_REQUIREMENT_COLORS.AVAILABLE_ITEM;
      } else if (isInconsequential) {
        itemColor = this.ITEM_REQUIREMENT_COLORS.INCONSEQUENTIAL_ITEM;
      } else {
        itemColor = this.ITEM_REQUIREMENT_COLORS.UNAVAILABLE_ITEM;
      }

      return [{
        color: itemColor,
        text: itemName,
      }];
    }

    return _.map(requirements.items, (item, index) => {
      const currentResult = [];
      const isInconsequentialForChild = isInconsequential || requirements.value;

      if (item.items) { // if the item is an expression
        currentResult.push([
          {
            color: this.ITEM_REQUIREMENT_COLORS.PLAIN_TEXT,
            text: '(',
          },
          this._createReadableRequirementsHelper(item, isInconsequentialForChild),
          {
            color: this.ITEM_REQUIREMENT_COLORS.PLAIN_TEXT,
            text: ')',
          },
        ]);
      } else {
        currentResult.push(this._createReadableRequirementsHelper(item, isInconsequentialForChild));
      }

      if (index < requirements.items.length - 1) {
        if (requirements.type === this._BOOLEAN_EXPRESSION_TYPES.AND) {
          currentResult.push({
            color: this.ITEM_REQUIREMENT_COLORS.PLAIN_TEXT,
            text: 'and',
          });
        } else if (requirements.type === this._BOOLEAN_EXPRESSION_TYPES.OR) {
          currentResult.push({
            color: this.ITEM_REQUIREMENT_COLORS.PLAIN_TEXT,
            text: 'or',
          });
        } else {
          throw Error(`Invalid requirements: ${JSON.stringify(requirements)}`);
        }
      }

      return currentResult;
    });
  }

  static _locationCountsColor(numAvailable, numRemaining, anyProgress) {
    if (numRemaining === 0) {
      return this.LOCATION_COLORS.CHECKED_LOCATION;
    }
    if (numAvailable === 0) {
      return this.LOCATION_COLORS.UNAVAILABLE_LOCATION;
    }
    if (anyProgress) {
      return this.LOCATION_COLORS.AVAILABLE_LOCATION;
    }
    return this.LOCATION_COLORS.NON_PROGRESS_LOCATION;
  }

  static _countLocationsBy(iteratee, { onlyProgressLocations }) {
    return _.sumBy(Locations.allGeneralLocations(), (generalLocation) => {
      const detailedLocations = LogicHelper.filterDetailedLocations(
        generalLocation,
        { onlyProgressLocations },
      );

      return _.sumBy(detailedLocations, (detailedLocation) => {
        if (detailedLocation === LogicHelper.DEFEAT_GANONDORF_LOCATION) {
          return 0;
        }

        return iteratee(generalLocation, detailedLocation);
      });
    });
  }

  _currentItemValue(itemName) {
    const guaranteedKeyCount = _.get(this.guaranteedKeys, itemName);
    if (!_.isNil(guaranteedKeyCount)) {
      return guaranteedKeyCount;
    }

    return this.state.getItemValue(itemName);
  }
}
