(function() {
  var templates = {
    menuOption: template('menuOption'),
    menuLink: template('menuLink'),
    menu: template('menu'),
    menuWidget: template('menuWidget')
  };

  var appId = Fliplet.Env.get('appId');

  var topMenu = Fliplet.App.Settings.get('topMenu') || {
    id: 'pages'
  };
  var $appMenu = $('#app-menu');
  var $customMenus = $('.custom-menus');

  var currentDataSource;
  var currentMenu;
  var currentProvider;
  var currentMenuItems = [];
  var activeTab = 'menu-settings';

  var menusPromises = {};
  var menuDataSources = [];
  var customMenus = [];
  var customMenuLoadingPromise;

  var isFilePickerClosed = false;

  function template(name) {
    return Handlebars.compile($('#template-' + name).html());
  }

  function addMenuOption(dataSource) {
    $appMenu.append(templates.menuOption(dataSource));
  }

  function setWidgetControls(tab) {
    switch (tab) {
      case 'styles':
        Fliplet.Widget.setSaveButtonLabel('');
        Fliplet.Widget.setCancelButtonLabel('Close');
        break;
      case 'links':
        Fliplet.Widget.setSaveButtonLabel('Save');
        Fliplet.Widget.setCancelButtonLabel('Cancel');
        break;
      case 'settings':
        Fliplet.Widget.setSaveButtonLabel('Save & Close');
        Fliplet.Widget.setCancelButtonLabel('Cancel');
        break;
      default:
        break;
    }
  }

  /**
   * We are using this function because there is a posibiblity that
   * our listener onEvent in the initLinkProvider function will fires after
   * this `cancel-button-pressed` event and so to avoid issue when we
   * redirect user to the menu styles tab we are using this fucntion.
   *
   * @returns {Promise} - return a value of the isFilePickerClosed.
   */
  function checkIfFilePickerClosing() {
    return new Promise(function(resolve) {
      setTimeout(function() {
        resolve(isFilePickerClosed);
      }, 0);
    });
  }

  function attachObservers() {
    // Listeners
    $('.nav.nav-tabs li a').on('click', function(event) {
      activeTab = $(event.target).attr('aria-controls');

      switch (activeTab) {
        case 'menu-manager':
          setWidgetControls('links');
          loadCustomMenus();
          break;
        case 'menu-settings':
        default:
          setWidgetControls('styles');
          break;
      }
    });

    window.addEventListener('message', function(event) {
      if (event.data === 'cancel-button-pressed') {
        if (currentProvider) {
          currentProvider.close();
          currentProvider = null;

          if (activeTab === 'menu-settings') {
            setWidgetControls('styles');
          } else if (activeTab === 'menu-manager') {
            setWidgetControls('links');
          }
        } else {
          switch (activeTab) {
            case 'menu-settings':
              Fliplet.Studio.emit('widget-save-complete');
              break;
            case 'menu-manager':
              checkIfFilePickerClosing()
                .then(function(isFilePickerClosing) {
                  if (!isFilePickerClosing) {
                    $('.nav.nav-tabs li a[aria-controls="menu-settings"]').trigger('click');
                  }

                  isFilePickerClosed = false;
                });
              break;
            default:
              break;
          }
        }

        Fliplet.Widget.toggleSaveButton(true);
      }
    });

    $('#add-link').on('click', function() {
      addLink(currentDataSource.id);
    });

    $('#accordion')
      .on('click', '.icon-delete', function() {
        var $item = $(this).closest('[data-id], .panel');
        var id = $item.data('id');

        $item.remove();

        for (var i = 0; i < menusPromises[currentDataSource.id].length; i++) {
          if (menusPromises[currentDataSource.id][i].row.id === id) {
            menusPromises[currentDataSource.id].splice(i, 1);
            currentMenuItems.splice(i, 1);
            break;
          }
        }
      })
      .on('keyup change paste', '.link-label', function() {
        $(this).parents('.panel').find('.panel-title-text').html(this.value);
      })
      .on('show.bs.collapse', '.panel-collapse', function() {
        var menuItemId = $(this).parent().data('id');

        ensureLinkProviderIsInitialized(menuItemId);

        $(this).siblings('.panel-heading').find('.fa-chevron-right').removeClass('fa-chevron-right').addClass('fa-chevron-down');
      })
      .on('hide.bs.collapse', '.panel-collapse', function() {
        $(this).siblings('.panel-heading').find('.fa-chevron-down').removeClass('fa-chevron-down').addClass('fa-chevron-right');
      })
      .on('shown.bs.collapse hidden.bs.collapse', '.panel-collapse', function() {
        $('.tab-content').trigger('scroll');
      });

    $appMenu.on('change', function() {
      var menuId = $(this).val();

      $('#accordion .menu').remove();
      $('#add-link').hide();

      if (menuId === 'pages' || menuId === '') {
        $('#menu-links').hide();
        currentDataSource = null;
        return;
      }

      var getMenu = Promise.resolve();

      $('#menu-links').show();

      if (!$('#menu-' + menuId).length) {
        var dataSource = _.find(menuDataSources, { id: parseInt(menuId, 10) });

        if (!dataSource) {
          console.warn('Menu data source not found');
          return;
        }

        getMenu = addMenu(dataSource);
      }

      getMenu.then(function() {
        $('#add-link').show();

        return Fliplet.DataSources.connect(menuId);
      }).then(function(source) {
        // Set current data source
        currentDataSource = source;
      });
    });

    $('header .closeSideView').on('click', function() {
      Fliplet.Studio.emit('navigate', { name: 'appEdit' });
    });

    Fliplet.Widget.onSaveRequest(function() {
      if (currentProvider) {
        return currentProvider.forwardSaveRequest();
      }

      saveManager();
      Fliplet.Studio.emit('reload-page-preview');
    });

    Fliplet.Widget.onCancelRequest(function() {
      if (menusPromises) {
        for (var key in menusPromises) {
          // skip loop if the property is from prototype
          if (!menusPromises.hasOwnProperty(key)) continue;

          var obj = menusPromises[key];
          for (var prop in obj) {
            // skip loop if the property is from prototype
            if (!obj.hasOwnProperty(prop)) continue;

            obj[prop].forwardCancelRequest();
          }
        }
      }
      if (!currentProvider) { return; }
      currentProvider.forwardCancelRequest();
    });

    // Handler to change the menu
    $('body').on('click', '[data-widget-id]', function(event) {
      event.preventDefault();
      var $el = $(this);
      var widgetId = $el.data('widget-id');
      $('.menu-styles-wrapper').addClass('loading');
      $('.radio_' + widgetId).prop('checked', true);

      // First, remove any existing menu widgetInstance
      Promise.all(customMenus.map(function(menu) {
        return Promise.all(menu.instances.map(function(instance) {
          return Fliplet.API.request({
            method: 'DELETE',
            url: 'v1/widget-instances/' + instance.id
          });
        }));
      })).then(function() {
        // Then, create the new instance
        return Fliplet.API.request({
          method: 'POST',
          url: 'v1/widget-instances?appId=' + Fliplet.Env.get('appId'),
          data: {
            widgetId: widgetId
          }
        });
      }).then(function() {
        Fliplet.Studio.emit('reload-page-preview');
        return loadCustomMenuWidgets();
      });
    })
      .on('click', '[data-settings]', function(event) {
        event.preventDefault();

        if (!currentMenu) {
          return;
        }

        currentProvider = Fliplet.Widget.open(currentMenu.id);
        setWidgetControls('settings');

        currentProvider.then(function() {
          currentProvider = null;
          Fliplet.Studio.emit('reload-page-preview');
          setWidgetControls('styles');
        });
      })
      .on('click', '[data-select-icon]', function() {
        var itemId = $(this).parents('.panel').data('id');
        var currentItem = _.find(currentMenuItems, function(item) {
          return item.id === itemId;
        });
        initIconProvider(currentItem);
      })
      .on('click', '.remove-icon', function() {
        var itemId = $(this).parents('.panel').data('id');
        var $parent = $(this).parents('.icon-selection-holder');
        var currentItem = _.find(currentMenuItems, function(item) {
          return item.id === itemId;
        });
        var iconBak = currentItem.data.icon;
        currentItem.data.icon = undefined;
        $parent.removeClass('icon-selected');
        $parent.find('.selected-icon').removeClass(iconBak);
      });
  }

  function fetchCustomMenuWidgets() {
    return Fliplet.API.request({
      url: [
        'v1/widgets?include_instances=true&tags=type:menu',
        '&appId=' + Fliplet.Env.get('appId'),
        '&organizationId=' + (Fliplet.Env.get('organizationId') || '')
      ].join('')
    }).then(function(response) {
      return Promise.resolve(response.widgets);
    });
  }

  function loadCustomMenuWidgets() {
    $('.menu-styles-wrapper').addClass('loading');
    return fetchCustomMenuWidgets().then(function(menus) {
      customMenus = menus;
      $customMenus.html('');

      menus.forEach(function(menu) {
        if (_.isEmpty(menu.settings)) {
          return;
        }

        if (menu.instances.length) {
          currentMenu = menu.instances[0];

          if (menu.hasInterface) {
            $('[data-settings]').removeClass('hidden');
          }
        }

        $customMenus.append(templates.menuWidget({
          widgetId: menu.id,
          instanceId: menu.instances.length ? menu.instances[0].id : null,
          name: menu.name,
          icon: menu.icon,
          settings: menu.settings && typeof menu.settings.showSettings !== 'undefined' ? menu.settings.showSettings : menu.hasInterface,
          gifIcon: menu.settings.gifIcon ? menu.baseAssetsUri + menu.settings.gifIcon : undefined
        }));
      });

      $('.menu-styles-wrapper').removeClass('loading');
    });
  }

  function initIconProvider(row) {
    row.data.icon = row.data.icon || '';

    currentProvider = Fliplet.Widget.open('com.fliplet.icon-selector', {
      // Also send the data I have locally, so that
      // the interface gets repopulated with the same stuff
      data: row.data,
      // Events fired from the provider
      onEvent: function(event, data) {
        switch (event) {
          case 'interface-validate':
            Fliplet.Widget.toggleSaveButton(data.isValid === true);
            break;
          case 'icon-clicked':
            Fliplet.Widget.toggleSaveButton(data.isSelected);
            break;
          default:
            break;
        }
      }
    });

    Fliplet.Studio.emit('widget-save-label-update', {
      text: 'Select & Save'
    });

    currentProvider.then(function(data) {
      if (data.data) {
        var previousIconClass = row.data.icon;
        row.data.icon = data && typeof data.data.icon !== 'undefined' ? data.data.icon : '';
        $('[data-id="' + row.id + '"] .icon-selection-holder').addClass('icon-selected');
        $('[data-id="' + row.id + '"] .selected-icon').removeClass(previousIconClass).addClass(data.data.icon);
        saveManager();
      }

      Fliplet.Studio.emit('widget-save-label-update', {
        text: 'Save'
      });
      currentProvider = null;
      return Promise.resolve();
    });
  }

  function saveManager() {
    showSuccessMessage();

    if (!currentDataSource) {
      topMenu.id = $appMenu.val();
      return Fliplet.App.Settings.set({
        topMenu: topMenu
      }).then(function() {
        Fliplet.Studio.emit('reload-page-preview');
      });
    }

    // Get order of links
    var sortedMenuItemIds = $('#menu-' + currentDataSource.id).sortable('toArray', {
      attribute: 'data-id'
    });

    // Update Links
    Promise.all(menusPromises[currentDataSource.id].map(function(provider) {
      // Do stuff in here with result from provider
      return new Promise(function(resolve) {
        provider.then(function(result) {
          provider.row.data.order = sortedMenuItemIds.indexOf(provider.row.id.toString());
          provider.row.data.linkLabel = $('[data-id="' + provider.row.id + '"]').find('.link-label').val();
          provider.row.data.action = result.data;
          provider.row.data.entryId = provider.row.id;
          resolve(provider.row.data);
        });
      });
    })).then(function(menuDataEntries) {
      return Fliplet.DataSources.connect(currentDataSource.id)
        .then(function(source) {
          mergeMenuEntries(menuDataEntries, sortedMenuItemIds);
          return source.replaceWith(menuDataEntries);
        });
    }).then(function() {
      topMenu.id = $appMenu.val();
      return Fliplet.App.Settings.set({
        topMenu: topMenu
      });
    }).then(function() {
      Fliplet.Studio.emit('reload-page-preview');
    });

    menusPromises[currentDataSource.id].forEach(function(linkActionProvider) {
      linkActionProvider.forwardSaveRequest();
    });
  }

  function showSuccessMessage() {
    $('#success-alert').addClass('saved');
    setTimeout(function() {
      $('#success-alert').removeClass('saved');
    }, 2000);
  }

  function initializeSortable(id) {
    $('#menu-' + id).sortable({
      handle: '.panel-heading',
      cancel: '.icon-delete',
      tolerance: 'pointer',
      revert: 150,
      placeholder: 'panel panel-default placeholder tile',
      cursor: '-webkit-grabbing; -moz-grabbing;',
      axis: 'y',
      start: function(event, ui) {
        var sortedItemId = $(ui.item).data('id');

        ensureLinkProviderIsInitialized(sortedItemId);

        $('.panel-collapse.in').collapse('hide');
        ui.item.addClass('focus').css('height', ui.helper.find('.panel-heading').outerHeight() + 2);
        $('.panel').not(ui.item).addClass('faded');
      },
      stop: function(event, ui) {
        ui.item.removeClass('focus');

        $('.panel').not(ui.item).removeClass('faded');

        saveManager();
      },
      sort: function() {
        $('#menu-' + id).sortable('refresh');
      }
    });
  }

  // Helpers
  function addMenu(dataSource) {
    if ($('#menu-' + dataSource.id).length) {
      return Promise.resolve();
    }

    $('#menu-loading').show();

    menusPromises[dataSource.id] = [];
    $('#accordion').append(templates.menu(dataSource));
    initializeSortable(dataSource.id);

    return Fliplet.DataSources.connect(dataSource.id)
      .then(function(source) {
        return source.find();
      })
      .then(function(rows) {
        if (!rows || !rows.length) {
          return Fliplet.Pages.get()
            .then(function(appPages) {
              $('#menu-loading').hide();
              appPages.forEach(function(page) {
                var newRow = {
                  data: {
                    action: {
                      action: 'screen',
                      page: page.id,
                      transition: 'slide.left'
                    },
                    linkLabel: page.title,
                    icon: 'fa fa-circle'
                  },
                  id: page.id
                };
                addLink(dataSource.id, newRow);
              });
            });
        }

        rows = _.sortBy(rows, 'data.order');
        $('#menu-loading').hide();
        rows.forEach(function(row) {
          addLink(dataSource.id, row);
        });
      });
  }

  /**
   * This function ensures the initLinkProvider method has been initialised
   * @param {int} menuItemId - an id of the menu item we should check
   * @returns {void}
  */
  function ensureLinkProviderIsInitialized(menuItemId) {
    var isProviderInited = menusPromises[currentDataSource.id].some(function(provider) {
      return provider.row.id === menuItemId;
    });

    // We sould init only a new provider to avoid erros with forward requests
    if (!isProviderInited) {
      currentMenuItems.some(function(menuItem) {
        if (menuItem.id === menuItemId) {
          // sets up new provider
          $('[data-id="' + menuItemId + '"] .link').html('');
          initLinkProvider(menuItem, currentDataSource.id);
          return true;
        }
      });
    }
  }

  /**
   *  Method to merge links where link provider wasn't called
   * @param {array} menuDataEntries - array of the entries which we will put into the data source
   * @param {array} sortedIds - array of the sorted menu id's
   * @returns {void}
  */
  function mergeMenuEntries(menuDataEntries, sortedIds) {
    currentMenuItems.forEach(function(menuItem) {
      var isMenuItemExists = menuDataEntries.some(function(entry) {
        return entry.entryId === menuItem.id;
      });
      var menuItemOrder = sortedIds.indexOf(menuItem.id.toString());

      // if menuItemOreder === -1 it means that no such DOM elem and we shouldn't add it
      if (!isMenuItemExists && menuItemOrder !== -1) {
        // Update link order in case it was chaged by the user
        menuItem.data.order = menuItemOrder;

        // Update link label in case it was changed by the user
        menuItem.data.linkLabel = $('[data-id="' + menuItem.id + '"]').find('.link-label').val();
        menuDataEntries.push(menuItem.data);
      }
    });
  }

  function initLinkProvider(row, dataSourceId) {
    row.data.action = row.data.action || {};
    row.data.action.provId = row.id;

    var linkActionProvider = Fliplet.Widget.open('com.fliplet.link', {
      // If provided, the iframe will be appended here,
      // otherwise will be displayed as a full-size iframe overlay
      selector: '[data-id="' + row.id + '"] .link',
      // Also send the data I have locally, so that
      // the interface gets repopulated with the same stuff
      data: row.data.action,
      // Events fired from the provider
      onEvent: function(event, data) {
        switch (event) {
          case 'inteface-validate':
            Fliplet.Widget.toggleSaveButton(!!data.isValid);
            break;
          case 'file-picker-closed':
            Fliplet.Widget.setSaveButtonLabel('Save');
            isFilePickerClosed = true;
            break;
          default:
            break;
        }
      },
      closeOnSave: false
    });

    linkActionProvider.then(function(data) {
      row.data.action = data && data.data.action !== 'none' ? data.data : null;
      return Promise.resolve();
    });

    linkActionProvider.row = row;
    menusPromises[dataSourceId].push(linkActionProvider);
  }

  function addLink(dataSourceId, row) {
    // Generate a random ID
    var id = 'id-' + Math.random().toString(36).substr(2, 16);

    // Check if it's an existing link or a new one
    row = row || {
      data: {
        action: {
          action: 'screen',
          page: '',
          transition: 'slide.left'
        },
        linkLabel: 'Menu Link'
      },
      id: id
    };

    currentMenuItems.push(row);

    $('#menu-' + dataSourceId).append(templates.menuLink(row));

    initLinkProvider(row, dataSourceId);
  }

  function loadCustomMenus() {
    if (customMenuLoadingPromise) {
      return customMenuLoadingPromise;
    }

    // Load custom menus
    customMenuLoadingPromise = Fliplet.DataSources.get({
      type: 'menu',
      appId: appId
    })
      .then(function(dataSources) {
        menuDataSources = dataSources;

        if (!menuDataSources.length) {
          var data = {
            appId: appId,
            name: 'Custom menu',
            type: 'menu'
          };

          return Fliplet.DataSources.create(data)
            .then(function(dataSource) {
              addMenuOption(dataSource);
              menuDataSources.push(dataSource);
              $('#menu-manager-loading').remove();
              $('#panel-holder').show();
              $appMenu.val(dataSource.id).change();
            });
        }

        dataSources.forEach(addMenuOption);
        $('#menu-manager-loading').remove();
        $('#panel-holder').show();
        $appMenu.val(topMenu.id).change();
      });
    return customMenuLoadingPromise;
  }

  attachObservers();
  // Load menu widgets on startup
  loadCustomMenuWidgets();
})();

Fliplet().then(function() {
  // Initial labels
  Fliplet.Widget.setSaveButtonLabel('');
  Fliplet.Widget.setCancelButtonLabel('Close');
  Fliplet.Widget.toggleCancelButton(true);
});
