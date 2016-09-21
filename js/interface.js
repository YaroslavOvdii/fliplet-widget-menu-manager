(function () {
  var templates = {
    menuOption: template('menuOption'),
    menuLink: template('menuLink'),
    menu: template('menu')
  };

  var topMenu = Fliplet.App.Settings.get('topMenu') || { id: 'pages' };
  var $appMenu = $('#app-menu');

  var currentDataSource;

  function template(name) {
    return Handlebars.compile($('#template-' + name).html());
  }

  var menusPromises = {};

  Fliplet.DataSources.get({ type: 'menu' })
    .then(function (dataSources) {
      if (dataSources.length === 0) {
        $("#initial-holder").show();
      } else {
        $("#panel-holder").show();
      }

      dataSources.forEach(function (dataSource) {
        addMenu(dataSource);
      });

      $appMenu
        .val(topMenu.id)
        .change(function () {
          topMenu.id = $(this).val();
          Fliplet.App.Settings.set({ topMenu: topMenu }).then(function () {
            Fliplet.Studio.emit('reload-page-preview');
          });
        });
    });

  // Listeners
  $('.add-menu').on('click', function () {
    Fliplet.DataSources.create({ name: 'Menu Title', type: 'menu' })
      .then(function (dataSource) {
        addMenu(dataSource);
        $('#select-menu').val(dataSource.id).change();
        $("#panel-holder").show();
        $("#initial-holder").hide();
      })
  });

  $('#add-link').on('click', function () {
    addLink(currentDataSource.id);
  });

  $('#delete-menu').on('click', function () {
    var menuId = getSelectedMenuId();
    Fliplet.DataSources.delete(menuId);
    delete(menusPromises[menuId]);
    $("#select-menu option[value='"+menuId+"']").remove();
    $appMenu.find("option[value='"+menuId+"']").remove();
    $('#select-menu').val(0).change();
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
        .then(function (source) {
          currentDataSource = source;
        })
    }
  });

  $('#save').on('click', function () {
    // Get new data source name
    var newMenuName = getMenuName();

    if (!currentDataSource.id) {
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
        .then(function () {
          setSelectedMenuName(newMenuName);
        });
    }

    // Get order of links
    var sortedIds = $('#menu-' + currentDataSource.id).sortable("toArray" ,{attribute: 'data-id'});

    // Update Links
    Promise.all(menusPromises[currentDataSource.id].map(function (provider) {
      // Set link order
      provider.row.data.order = sortedIds.indexOf(provider.row.id.toString());

      // Do stuff in here with result from provider
      return new Promise(function (resolve, reject) {
        provider.then(function (result) {
          provider.row.data.action = result;
          resolve(provider.row.data);
        });
      });
    })).then(function (entries) {
      return Fliplet.DataSources.connect(currentDataSource.id)
        .then(function (source) {
          return source.replaceWith(entries);
        })
    });

    menusPromises[currentDataSource.id].forEach(function (linkActionProvider) {
      linkActionProvider.forwardSaveRequest();
    })
  });

  // Helpers
  function addMenu(dataSource) {
    menusPromises[dataSource.id] = [];
    $('#select-menu').append(templates.menuOption(dataSource));
    $('#accordion').append(templates.menu(dataSource));

    $appMenu.append(templates.menuOption(dataSource));

    Fliplet.DataSources.connect(dataSource.id)
      .then(function (source) {
        return source.find();
      })
      .then(function (rows) {
        if (!rows || !rows.length) {
          return;
        }

        rows = _.sortBy(rows, 'data.order');
        rows.forEach(function (row) {
          addLink(dataSource.id, row);
        });
      });

    $('#menu-' + dataSource.id).sortable({
      handle: ".panel-heading",
      cancel: ".icon-delete",
      start: function(event, ui) {
        $('.panel-collapse.in').collapse('hide');
        ui.item.addClass('focus').css('height', ui.helper.find('.panel-heading').outerHeight() + 2);
        $('.panel').not(ui.item).addClass('faded');
      },
      stop: function(event, ui) {
        ui.item.removeClass('focus');
        $('.panel').not(ui.item).removeClass('faded');
      }
    });
  }

  function addLink(dataSourceId, row) {
    // Generate a random ID
    var id = 'id-' + Math.random().toString(36).substr(2, 16);

    // Check if it's an existing link or a new one
    row = row || {
        data: {
          action: {
            options: {label: true},
            linkLabel: 'Link label'
          }
        },
        id: id
      };

    $('#menu-' + dataSourceId).append(templates.menuLink(row));

    var linkActionProvider = Fliplet.Widget.open('com.fliplet.link', {
      closeOnSave: false,
      selector: '[data-id='+ row.id +']  .link',
      data: row.data.action
    });

    linkActionProvider.row = row;
    menusPromises[dataSourceId].push(linkActionProvider);
  }


  // Getters / Setters
  function getSelectedMenuId() {
    return $('#select-menu').val();
  }

  function getSelectedMenuName() {
    return $('#select-menu option:selected').text();
  }

  function setSelectedMenuName(name) {
    return $('#select-menu option:selected').text(name);
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
