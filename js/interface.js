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

  function template(name) {
    return Handlebars.compile($('#template-' + name).html());
  }

  var menusPromises = {};

  Fliplet.DataSources.get({
      type: 'menu',
      appId: appId,
    })
    .then(function(dataSources) {
      if (dataSources.length === 0) {
        $("#initial-holder").show();
      } else {
        $("#panel-holder").show();
      }

      dataSources.forEach(function(dataSource) {
        addMenu(dataSource);
      });

      $appMenu.val(topMenu.id).change();
    });

  // Listeners
  $('.add-menu').on('click', function() {
    var data = {
      appId: appId,
      name: 'Untitled menu',
      type: 'menu'
    };
    Fliplet.DataSources.create(data)
      .then(function(dataSource) {
        addMenu(dataSource);
        $('#select-menu').val(dataSource.id).change();
        $("#panel-holder").show();
        $("#initial-holder").hide();
      });
  });

  $('#add-link').on('click', function() {
    addLink(currentDataSource.id);
  });

  $('#delete-menu').on('click', function() {
    var menuId = getSelectedMenuId();
    Fliplet.DataSources.delete(menuId);
    delete(menusPromises[menuId]);
    $("#select-menu option[value='" + menuId + "']").remove();
    $appMenu.find("option[value='" + menuId + "']").remove();
    $('#select-menu').val(0).change();
    if ($.isEmptyObject(menusPromises)) {
      $('#panel-holder').hide();
      $('#initial-holder').show();
    }

    // Check if the main setting menu is this one and if it is changed it to All links
    if (topMenu.id == menuId) {
      $appMenu.val('pages').change();
      saveSettings();
    }
  });

  $("#accordion")
    .on('click', '.icon-delete', function() {
      var $item = $(this).closest("[data-id], .panel"),
        id = $item.data('id');

      $item.remove();

      for (var i = 0; i < menusPromises[currentDataSource.id].length; i++) {
        if (menusPromises[currentDataSource.id][i].row.id === id) {
          menusPromises[currentDataSource.id].splice(i, 1);
          break;
        }
      }
    })
    .on('keyup change paste', '.link-label', function() {
      $(this).parents('.panel').find('.panel-title-text').html(this.value);
    })
    .on('show.bs.collapse', '.panel-collapse', function() {
      $(this).siblings('.panel-heading').find('.fa-chevron-right').removeClass('fa-chevron-right').addClass('fa-chevron-down');
    })
    .on('hide.bs.collapse', '.panel-collapse', function() {
      $(this).siblings('.panel-heading').find('.fa-chevron-down').removeClass('fa-chevron-down').addClass('fa-chevron-right');
    })
    .on('shown.bs.collapse hidden.bs.collapse', '.panel-collapse', function() {
      $('.tab-content').trigger('scroll');
    });

  $('#select-menu').on('change', function onMenuChange() {
    updateSelectMenuText();

    // Change visible links
    var menuId = $(this).val();

    // Hide all menu panels
    $('#accordion .menu').hide();

    // Show only the selected one
    $('#menu-' + menuId).show();

    // Change menu name on input
    var menuName = getSelectedMenuName();
    setMenuName(menuName);

    // Set current data source
    if (menuId == 0) {
      $('#menu-name-group').hide();
      $('#save').hide();
      $('#menu-links').hide();
      currentDataSource = null;
      $('#add-link').hide();
    } else {
      $('#menu-name-group').show();
      $('#add-link').show();
      $('#save').show();
      $('#menu-links').show();
      Fliplet.DataSources.connect(menuId)
        .then(function(source) {
          currentDataSource = source;
        });
    }
  });

  $('#menu-manager-link').on('click', function() {
    $('.nav-tabs .active').removeClass('active');
    $('#menu-manager-control').addClass('active');
  });

  $appMenu.on('change', function() {
    var selectedText = $(this).find('option:selected').text();
    $(this).parents('.select-proxy-display').find('.select-value-proxy').html(selectedText);
  });

  $('header .betaAlert').on('click', function() {
    alert('During beta, please use live chat and let us know what you need help with.');
  });

  $('header .closeSideView').on('click', function() {
    Fliplet.Studio.emit('navigate', { name: 'appEdit' });
  });

  Fliplet.Widget.onSaveRequest(function() {
    if (currentProvider) {
      return currentProvider.forwardSaveRequest();
    }

    var tab = $('#menu-manager-control').hasClass('active') ? 'manager' : 'settings';
    switch (tab) {
      case 'manager':
        saveManager();
        break;
      case 'settings':
        saveSettings();
        break;
    }
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
          if(!obj.hasOwnProperty(prop)) continue;

          obj[prop].forwardCancelRequest();
        }
      }
    }
    if (!currentProvider) { return; }
    currentProvider.forwardCancelRequest();
  });

  function fetchCustomMenus() {
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

  var customMenus = [];

  function loadCustomMenus() {
    $('.menu-styles-wrapper').addClass('loading');
    return fetchCustomMenus().then(function(menus) {
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
          settings: menu.hasInterface,
          gifIcon: menu.settings.gifIcon ? menu.baseAssetsUri + menu.settings.gifIcon : undefined
        }));
      });

      if ($('.menu-style-radios:checked').data('menu-name') === 'Swipe') {
        $('#app-menu').val('pages').trigger('change').prop('disabled', true);
        $('#menu-manager-control').addClass('disabled');
        $('#menu-manager-link').addClass('disabled');
      }

      $('.menu-styles-wrapper').removeClass('loading');
    });
  }

  // Load menus on startup
  loadCustomMenus();

  // Handler to change the menu
  $('body').on('click', '[data-widget-id]', function(event) {
      event.preventDefault();
      var $el = $(this);
      var widgetId = $el.data('widget-id');
      var menuName = $('.radio_' + widgetId).data('menu-name');
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
      }).then(function(menu) {
        if (menuName === 'Swipe') {
          $('#app-menu').val('pages').trigger('change').prop('disabled', true);
          $('#menu-manager-control').addClass('disabled');
          $('#menu-manager-link').addClass('disabled');
          saveSettings();
        } else {
          $('#app-menu').prop('disabled', false);
          $('#menu-manager-control').removeClass('disabled');
          $('#menu-manager-link').removeClass('disabled');
        }
        Fliplet.Studio.emit('reload-page-preview');
        return loadCustomMenus();
      });
    })
    .on('click', '[data-settings]', function(event) {
      event.preventDefault();

      if (!currentMenu) {
        return;
      }

      currentProvider = Fliplet.Widget.open(currentMenu.id);

      currentProvider.then(function() {
        currentProvider = null;
        Fliplet.Studio.emit('reload-page-preview');
      });
    });

  function saveSettings() {
    topMenu.id = $appMenu.val();
    Fliplet.App.Settings.set({
      topMenu: topMenu
    }).then(function() {
      Fliplet.Studio.emit('reload-page-preview');
    });

    showSuccessMessage();
  }

  function saveManager() {
    // Get new data source name
    var newMenuName = getMenuName();

    if (!currentDataSource) {
      return;
    }

    // Update data source if name was changed
    if (getSelectedMenuName() !== newMenuName) {
      $("#select-menu option:selected").text(newMenuName);
      updateSelectMenuText();
      $appMenu.find("option[value='" + currentDataSource.id + "']").text(newMenuName).change();

      var updateOptions = {
        id: currentDataSource.id,
        name: newMenuName
      };

      Fliplet.DataSources.update(updateOptions)
        .then(function() {
          $('#select-menu option:selected').text(newMenuName);
        });
    }

    // Get order of links
    var sortedIds = $('#menu-' + currentDataSource.id).sortable("toArray", {
      attribute: 'data-id'
    });

    // Update Links
    Promise.all(menusPromises[currentDataSource.id].map(function(provider) {
      // Do stuff in here with result from provider
      return new Promise(function(resolve, reject) {
        provider.then(function(result) {
          provider.row.data.order = sortedIds.indexOf(provider.row.id.toString());
          provider.row.data.linkLabel = $('[data-id="' + provider.row.id + '"]').find('.link-label').val();
          provider.row.data.action = result.data;
          resolve(provider.row.data);
        });
      });
    })).then(function(entries) {
      return Fliplet.DataSources.connect(currentDataSource.id)
        .then(function(source) {
          return source.replaceWith(entries);
        });
    }).then(function() {
      // Reload the screen when we make changes to the current menu and save
      if ($appMenu.val() == currentDataSource.id) {
        Fliplet.Studio.emit('reload-page-preview');
      }
    });

    menusPromises[currentDataSource.id].forEach(function(linkActionProvider) {
      linkActionProvider.forwardSaveRequest();
    });

    showSuccessMessage();
  }

  function showSuccessMessage() {
    $('#success-alert').addClass('saved');
    setTimeout(function() {
      $('#success-alert').removeClass('saved');
    }, 2000);
  }

  // Helpers
  function addMenu(dataSource) {
    menusPromises[dataSource.id] = [];
    $('#select-menu').append(templates.menuOption(dataSource));
    $('#accordion').append(templates.menu(dataSource));

    $appMenu.append(templates.menuOption(dataSource));

    Fliplet.DataSources.connect(dataSource.id)
      .then(function(source) {
        return source.find();
      })
      .then(function(rows) {
        if (!rows || !rows.length) {
          return;
        }

        rows = _.sortBy(rows, 'data.order');
        rows.forEach(function(row) {
          addLink(dataSource.id, row);
        });
      });

    $('#menu-' + dataSource.id).sortable({
      handle: ".panel-heading",
      cancel: ".icon-delete",
      tolerance: 'pointer',
      revert: 150,
      placeholder: 'panel panel-default placeholder tile',
      cursor: '-webkit-grabbing; -moz-grabbing;',
      axis: 'y',
      start: function(event, ui) {
        var itemId = $(ui.item).data('id');
        var itemProvider = _.find(menusPromises[currentDataSource.id], function(provider) {
          return provider.row.id === itemId;
        });

        saveManager();

        // removes provider
        itemProvider = null;
        _.remove(menusPromises[currentDataSource.id], function(provider) {
          return provider.row.id === itemId;
        });

        $('.panel-collapse.in').collapse('hide');
        ui.item.addClass('focus').css('height', ui.helper.find('.panel-heading').outerHeight() + 2);
        $('.panel').not(ui.item).addClass('faded');
      },
      stop: function(event, ui) {
        var itemId = $(ui.item).data('id');
        var movedItem = _.find(currentMenuItems, function(item) {
          return item.id === itemId;
        });

        // sets up new provider
        $('[data-id="' + itemId + '"] .link').html('');
        console.log(movedItem);
        initLinkProvider(movedItem, currentDataSource.id);

        ui.item.removeClass('focus');

        $('.panel').not(ui.item).removeClass('faded');

        saveManager();
      },
      sort: function(event, ui) {
        $('#menu-' + dataSource.id).sortable('refresh');
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
        if (event === 'interface-validate') {
          Fliplet.Widget.toggleSaveButton(data.isValid === true);
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

  // Getters / Setters
  function getSelectedMenuId() {
    return $('#select-menu').val();
  }

  function getSelectedMenuName() {
    return $('#select-menu option:selected').text();
  }

  function getMenuName() {
    return $('#menu-name').val();
  }

  function setMenuName(name) {
    return $('#menu-name').val(name);
  }

  function updateSelectMenuText() {
    var selectedText = $('#select-menu').find('option:selected').text();
    $('#select-menu').parents('.select-proxy-display').find('.select-value-proxy').html(selectedText);
  }
})();